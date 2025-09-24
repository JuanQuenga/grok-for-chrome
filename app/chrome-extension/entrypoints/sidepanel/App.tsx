import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/button';
import { Input } from '../../components/ui/input';
import { Card, CardContent } from '../../components/ui/card';
import {
  CheckCircle2,
  XCircle,
  Info,
  Loader2,
  Square,
  Settings,
  History,
  Plus,
  Paperclip,
  RotateCcw,
  X,
  MessageSquare,
  Clock,
  Trash2,
  Code,
  Mic,
  MicOff,
  DollarSign,
  Film,
  CheckSquare,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '../../lib/utils';
import { GrokService } from '../../services/grok';
import { PromptService } from '../../services/prompts';
import type { GrokTool } from '../../types/grok';

type ChatMessage = {
  role: 'user' | 'assistant' | 'system' | 'function';
  content: string;
  name?: string;
  automation?: {
    isAutomation: true;
    success?: boolean;
    action?: string;
    debug?: any;
  };
};

interface ConversationMetadata {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

interface PromptType {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  badgeClass: string;
}

const promptTypes: PromptType[] = [
  {
    id: 'content-analyze',
    name: 'Content Analysis',
    description: 'Analyze and visualize web content',
    icon: <Info className="w-4 h-4" />,
    badgeClass: 'bg-white/10 border border-white/10 text-foreground',
  },
  {
    id: 'modify-web',
    name: 'Web Modification',
    description: 'Modify web pages safely',
    icon: <Code className="w-4 h-4" />,
    badgeClass: 'bg-white/10 border border-white/10 text-foreground',
  },
  {
    id: 'price-matching',
    name: 'Price Matching',
    description: 'Compare prices across popular retailers',
    icon: <DollarSign className="w-4 h-4" />,
    badgeClass: 'bg-white/10 border border-white/10 text-foreground',
  },
  {
    id: 'movie-showtimes',
    name: 'Movie Showtimes',
    description: 'Find movie showtimes and tickets at local theaters',
    icon: <Film className="w-4 h-4" />,
    badgeClass: 'bg-white/10 border border-white/10 text-foreground',
  },
  {
    id: 'excalidraw',
    name: 'Excalidraw Control',
    description: 'Create diagrams programmatically',
    icon: <Paperclip className="w-4 h-4" />,
    badgeClass: 'bg-white/10 border border-white/10 text-foreground',
  },
];

function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>('grok-4-fast-reasoning');
  const [liveSearchMode, setLiveSearchMode] = useState<'auto' | 'on' | 'off'>('auto');
  const [isRecording, setIsRecording] = useState(false);
  const recognitionRef = useRef<any>(null);
  const [loading, setLoading] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const [selectedPrompt, setSelectedPrompt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [thinkingData, setThinkingData] = useState<
    { name: string; description: string; result?: any }[]
  >([]);
  const [todoItems, setTodoItems] = useState<any[]>([]);
  const [expandedMessageIds, setExpandedMessageIds] = useState<Record<number, boolean>>({});

  const MAX_RENDER_CHARS = 1200; // collapse threshold

  function sanitizeAndTrimMarkdown(text: string): string {
    if (!text) return '';
    // Basic trimming and normalization
    let t = text.trim();
    // Remove duplicated whitespace lines
    t = t.replace(/\n{3,}/g, '\n\n');
    // Clip extreme length to keep UI snappy (server already constrained)
    if (t.length > 12000) t = t.slice(0, 12000) + '\n\n…';
    return t;
  }

  function getDisplayText(index: number, text: string): { content: string; truncated: boolean } {
    const isExpanded = !!expandedMessageIds[index];
    const sanitized = sanitizeAndTrimMarkdown(text);
    if (sanitized.length <= MAX_RENDER_CHARS || isExpanded) {
      return { content: sanitized, truncated: false };
    }
    return { content: sanitized.slice(0, MAX_RENDER_CHARS) + '\n\n…', truncated: true };
  }

  // Conversation history state
  const [conversationId, setConversationId] = useState<string>('');
  const [conversationHistory, setConversationHistory] = useState<ConversationMetadata[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [needsFork, setNeedsFork] = useState(false);

  // Usage tracking
  const [lastPromptTokens, setLastPromptTokens] = useState<number | null>(null);
  const [lastCompletionTokens, setLastCompletionTokens] = useState<number | null>(null);
  const [sessionPromptTokens, setSessionPromptTokens] = useState<number>(0);
  const [sessionCompletionTokens, setSessionCompletionTokens] = useState<number>(0);
  const [totalPromptTokens, setTotalPromptTokens] = useState<number>(0);
  const [totalCompletionTokens, setTotalCompletionTokens] = useState<number>(0);

  const grokService = useRef(new GrokService());
  const promptService = useRef(new PromptService());
  const listRef = useRef<HTMLDivElement>(null);

  // Set dark theme by default
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  // Load settings and conversation data
  useEffect(() => {
    (async () => {
      try {
        const stored = await chrome.storage?.local.get([
          'grok_model',
          'live_search_mode',
          'total_prompt_tokens',
          'total_completion_tokens',
        ]);
        // Prefer sync for api key, fallback to local for backward compatibility
        let k = '';
        try {
          const syncStored = await chrome.storage?.sync.get(['grok_api_key']);
          k = syncStored?.grok_api_key || '';
        } catch (e) {
          console.warn('Failed to read grok_api_key from sync storage', e);
        }
        if (!k) {
          const localKRes = await chrome.storage?.local.get(['grok_api_key']);
          k = localKRes?.grok_api_key || '';
        }
        setApiKey(k);
        setHasKey(!!k);

        // model (sync preferred, fallback to local)
        try {
          const syncStored = await chrome.storage?.sync.get(['grok_model']);
          const model = syncStored?.grok_model || stored?.grok_model || 'grok-4-fast-reasoning';
          setSelectedModel(model);
          await grokService.current.setModel(model);
        } catch (e) {
          console.warn('Failed to sync model from storage, using default', e);
        }

        // live search mode
        setLiveSearchMode((stored?.live_search_mode as any) || 'auto');
        if (stored?.total_prompt_tokens) {
          setTotalPromptTokens(stored.total_prompt_tokens);
        }
        if (stored?.total_completion_tokens) {
          setTotalCompletionTokens(stored.total_completion_tokens);
        }

        // Load conversation history
        await loadConversationHistory();

        // Start new conversation if none exists
        if (!conversationId) {
          handleStartNewConversation();
        }
      } catch (error) {
        console.error('Failed to load settings:', error);
      }
    })();
  }, []);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight);
  }, [messages]);

  // Conversation storage functions
  const generateConversationId = () => {
    return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  };

  const saveConversation = async (id: string, messages: ChatMessage[]) => {
    try {
      const conversation = {
        id,
        messages,
        title: messages[0]?.content?.substring(0, 50) || 'New Conversation',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: messages.length,
      };
      await chrome.storage.local.set({ [`conversation_${id}`]: conversation });
      loadConversationHistory();
    } catch (error) {
      console.error('Failed to save conversation:', error);
    }
  };

  const loadConversation = async (id: string): Promise<ChatMessage[] | null> => {
    try {
      const result = await chrome.storage.local.get([`conversation_${id}`]);
      return result[`conversation_${id}`]?.messages || null;
    } catch (error) {
      console.error('Failed to load conversation:', error);
      return null;
    }
  };

  const loadConversationHistory = async () => {
    try {
      const allKeys = await chrome.storage.local.get(null);
      const conversations: ConversationMetadata[] = [];

      for (const key of Object.keys(allKeys)) {
        if (key.startsWith('conversation_')) {
          const conv = allKeys[key];
          conversations.push({
            id: conv.id,
            title: conv.title,
            createdAt: conv.createdAt,
            updatedAt: conv.updatedAt,
            messageCount: conv.messageCount,
          });
        }
      }

      // Sort by updatedAt descending
      conversations.sort(
        (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
      setConversationHistory(conversations);
    } catch (error) {
      console.error('Failed to load conversation history:', error);
    }
  };

  const deleteConversation = async (id: string): Promise<boolean> => {
    try {
      await chrome.storage.local.remove([`conversation_${id}`]);
      return true;
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      return false;
    }
  };

  const clearAllConversations = async (): Promise<boolean> => {
    try {
      const allKeys = await chrome.storage.local.get(null);
      const convKeys = Object.keys(allKeys).filter((key) => key.startsWith('conversation_'));
      await chrome.storage.local.remove(convKeys);
      return true;
    } catch (error) {
      console.error('Failed to clear conversations:', error);
      return false;
    }
  };

  // Conversation handlers
  function handleStartNewConversation() {
    const newId = generateConversationId();
    setConversationId(newId);
    setMessages([]);
    setInput('');
    setShowHistory(false);
    setNeedsFork(false);
    // Reset session token counters for new conversation
    setSessionPromptTokens(0);
    setSessionCompletionTokens(0);
    setLastPromptTokens(null);
    setLastCompletionTokens(null);
  }

  function handleResetTotalUsage() {
    setTotalPromptTokens(0);
    setTotalCompletionTokens(0);
    chrome.storage?.local.set({
      total_prompt_tokens: 0,
      total_completion_tokens: 0,
    });
  }

  async function handleSelectConversation(id: string) {
    const conversation = await loadConversation(id);
    if (conversation) {
      setConversationId(id);
      setMessages(conversation);
      setNeedsFork(true); // Mark as needing fork since we're viewing archived chat
      setShowHistory(false);
    }
  }

  async function handleDeleteConversation(id: string) {
    if (confirm('Are you sure you want to delete this conversation?')) {
      if (await deleteConversation(id)) {
        await loadConversationHistory();
        // If we deleted the current conversation, start a new one
        if (id === conversationId) {
          handleStartNewConversation();
        }
      }
    }
  }

  async function handleClearAllConversations() {
    if (confirm('Are you sure you want to delete all conversations? This cannot be undone.')) {
      if (await clearAllConversations()) {
        setConversationHistory([]);
        handleStartNewConversation();
      }
    }
  }

  // Settings handlers
  async function saveSettings() {
    await grokService.current.setApiKey(apiKey);
    await grokService.current.setModel(selectedModel);
    await chrome.storage?.local.set({ live_search_mode: liveSearchMode });
    await chrome.storage?.sync.set({ grok_model: selectedModel });
    setHasKey(!!apiKey);
    setIsSettingsOpen(false);
  }

  function cancelRequest() {
    if (abortController) {
      abortController.abort();
      setAbortController(null);
      setLoading(false);
      setThinkingData([]);
      setTodoItems([]); // Clear TODO items on cancellation
    }
  }

  async function handleSend() {
    if (!input.trim()) return;
    if (!hasKey) {
      setIsSettingsOpen(true);
      return;
    }

    // Fork conversation if viewing archived chat
    if (needsFork) {
      const newId = generateConversationId();
      setConversationId(newId);
      setNeedsFork(false);
    }

    const userMsg: ChatMessage = { role: 'user', content: input.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    setThinkingData([]); // Clear previous thinking data
    setTodoItems([]); // Clear previous TODO items for new request

    // Create abort controller for this request
    const controller = new AbortController();
    setAbortController(controller);

    try {
      // Get current browser context
      const context = await grokService.current.getCurrentBrowserContext();

      // Use selected prompt or proceed without one
      let promptContent = '';
      if (selectedPrompt) {
        const prompt = await promptService.current.getPrompt(selectedPrompt);
        if (prompt) {
          promptContent = prompt.content;
        }
      }

      // Map MCP tool schemas to Grok tool format
      const { TOOL_SCHEMAS } = await import('chrome-mcp-shared');
      const grokTools: GrokTool[] = TOOL_SCHEMAS.map(
        (t: any) =>
          ({
            type: 'function',
            function: {
              name: t.name,
              description: t.description,
              parameters: t.inputSchema || { type: 'object', properties: {}, required: [] },
            },
          }) as GrokTool,
      );

      // Execute with Grok
      const conversationHistory = [...messages, userMsg].map((msg) => ({
        role: msg.role === 'function' ? ('tool' as const) : msg.role,
        content: msg.content,
        name: msg.name,
      }));
      const result = await grokService.current.executeWithPrompt(
        conversationHistory,
        promptContent,
        context,
        grokTools,
        (toolCall) => {
          setThinkingData((prev) => [...prev, toolCall]);

          // Update TODO items when TODO tools are executed
          if (toolCall.name.startsWith('todo_') && toolCall.result) {
            if (toolCall.name === 'todo_create' || toolCall.name === 'todo_list') {
              // Refresh the TODO list
              setTimeout(async () => {
                try {
                  const listResult = await chrome.runtime.sendMessage({
                    type: 'EXECUTE_TOOL',
                    name: 'todo_list',
                    args: {},
                  });
                  if (listResult?.success && listResult.result?.todos) {
                    setTodoItems(listResult.result.todos);
                  }
                } catch (error) {
                  console.warn('Failed to refresh TODO list:', error);
                }
              }, 100);
            } else if (toolCall.name === 'todo_update' || toolCall.name === 'todo_complete') {
              // Update specific TODO item
              setTodoItems((prev) =>
                prev.map((todo) =>
                  todo.id === toolCall.result?.id ? { ...todo, ...toolCall.result } : todo,
                ),
              );
            }
          }
        },
      );

      // Add assistant response
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: result.message,
      };

      const updatedMessages = [...messages, userMsg, assistantMessage];
      setMessages(updatedMessages);

      // Save conversation
      if (conversationId) {
        await saveConversation(conversationId, updatedMessages);
      }

      if (!result.success) {
        setError(result.message);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unknown error occurred';
      setError(errorMessage);

      const errorResponse: ChatMessage = {
        role: 'assistant',
        content: `Error: ${errorMessage}`,
      };

      const updatedMessages = [...messages, userMsg, errorResponse];
      setMessages(updatedMessages);

      // Save conversation with error
      if (conversationId) {
        await saveConversation(conversationId, updatedMessages);
      }
    } finally {
      setLoading(false);
      setAbortController(null);
      setThinkingData([]); // Clear thinking data after completion
      // Keep TODO items visible after completion for user reference
    }
  }

  // Microphone input using Web Speech API
  function toggleRecording() {
    if (isRecording) {
      try {
        recognitionRef.current?.stop?.();
      } catch (e) {
        console.warn('Failed to stop recognition', e);
      }
      setIsRecording(false);
      return;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setError('Speech recognition not supported in this browser');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = true;
    recognition.continuous = true;

    recognition.onresult = (event: any) => {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }
      setInput((prev) => {
        const base = prev?.trim().length ? prev + ' ' : '';
        return base + transcript.trim();
      });
    };
    recognition.onerror = () => {
      setIsRecording(false);
    };
    recognition.onend = () => {
      setIsRecording(false);
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsRecording(true);
  }

  // ConversationHistory component
  function ConversationHistory({
    conversations,
    currentConversationId,
    onSelectConversation,
    onDeleteConversation,
    onClearAll,
    onClose,
  }: {
    conversations: ConversationMetadata[];
    currentConversationId: string;
    onSelectConversation: (id: string) => void;
    onDeleteConversation: (id: string) => void;
    onClearAll: () => void;
    onClose: () => void;
  }) {
    const formatDate = (dateString: string) => {
      const date = new Date(dateString);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffHours = diffMs / (1000 * 60 * 60);

      if (diffHours < 24) {
        return date.toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
        });
      } else if (diffHours < 24 * 7) {
        return date.toLocaleDateString([], { weekday: 'short' });
      } else {
        return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
      }
    };

    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
        <Card className="w-[500px] max-w-[90vw] max-h-[80vh] flex flex-col">
          <div className="flex flex-row items-center justify-between p-4 border-b">
            <h2 className="flex items-center gap-2 font-semibold">
              <MessageSquare className="h-5 w-5" />
              Chat History
            </h2>
            <div className="flex gap-2">
              {conversations.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onClearAll}
                  className="text-destructive hover:text-destructive"
                >
                  Clear All
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {conversations.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <MessageSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>No conversations yet</p>
                <p className="text-sm">Start chatting to see your history here</p>
              </div>
            ) : (
              <div className="space-y-2">
                {conversations.map((conversation) => (
                  <div
                    key={conversation.id}
                    className={`p-3 rounded-lg border cursor-pointer transition-colors hover:bg-muted/50 ${
                      conversation.id === currentConversationId
                        ? 'bg-primary/5 border-primary/20'
                        : 'bg-card border-border'
                    }`}
                    onClick={() => onSelectConversation(conversation.id)}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <h4 className="font-medium text-sm truncate">{conversation.title}</h4>
                        <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatDate(conversation.updatedAt)}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteConversation(conversation.id);
                        }}
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div className="flex items-center gap-2">
          <img
            src={chrome.runtime.getURL('icons/icon.svg')}
            alt="Grok"
            className="w-5 h-5"
            style={{ filter: 'invert(1)' }}
          />
          <h1 className="font-semibold">Grok</h1>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={handleStartNewConversation}
            title="New Chat"
          >
            <Plus className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={() => setShowHistory(true)}
            title="Chat History"
          >
            <History className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={() => setIsSettingsOpen(true)}>
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className="mx-4 mt-2 p-2 rounded border border-destructive/20 bg-destructive/10">
          <div className="flex items-center gap-2 text-sm">
            <XCircle className="h-4 w-4 text-destructive" />
            <span>{error}</span>
          </div>
        </div>
      )}

      {/* Prompt Selection */}
      {messages.length === 0 && (
        <div className="p-4 space-y-4">
          <h2 className="text-sm font-medium">Choose a workflow:</h2>
          <div className="grid gap-2">
            {promptTypes.map((prompt) => (
              <Card
                key={prompt.id}
                className={cn(
                  'cursor-pointer transition-all hover:shadow-md',
                  selectedPrompt === prompt.id && 'ring-2 ring-primary',
                )}
                onClick={() => setSelectedPrompt(prompt.id)}
              >
                <CardContent className="p-3">
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-md bg-muted">{prompt.icon}</div>
                    <div>
                      <h3 className="font-medium text-sm">{prompt.name}</h3>
                      <p className="text-xs text-muted-foreground">{prompt.description}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div ref={listRef} className="flex-1 overflow-y-auto p-4">
        <div className="space-y-4 max-w-4xl mx-auto">
          {messages.map((message, index) => (
            <div
              key={index}
              className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}
            >
              <div
                className={cn(
                  'max-w-[80%] rounded-lg px-3 py-2',
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {message.automation && (
                  <div className="text-xs opacity-75 mb-1 flex items-center gap-1">
                    {message.automation.success ? (
                      <CheckCircle2 className="h-3 w-3 text-green-500" />
                    ) : (
                      <XCircle className="h-3 w-3 text-red-500" />
                    )}
                    {message.automation.action}
                  </div>
                )}
                {(() => {
                  const { content, truncated } = getDisplayText(index, message.content);
                  return (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                          a: ({ node, ...props }) => (
                            <a {...props} target="_blank" rel="noopener noreferrer" />
                          ),
                        }}
                      >
                        {content}
                      </ReactMarkdown>
                      {truncated && (
                        <div className="mt-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-2"
                            onClick={() =>
                              setExpandedMessageIds((prev) => ({
                                ...prev,
                                [index]: true,
                              }))
                            }
                          >
                            Show more
                          </Button>
                        </div>
                      )}
                      {!truncated &&
                        expandedMessageIds[index] &&
                        message.content.length > MAX_RENDER_CHARS && (
                          <div className="mt-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2"
                              onClick={() =>
                                setExpandedMessageIds((prev) => ({
                                  ...prev,
                                  [index]: false,
                                }))
                              }
                            >
                              Show less
                            </Button>
                          </div>
                        )}
                    </div>
                  );
                })()}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-3 py-2 max-w-[80%]">
                <div className="flex items-center gap-2 mb-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span className="text-sm font-medium">Grok is thinking...</span>
                </div>
                {thinkingData.length > 0 && (
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {thinkingData.map((data, index) => {
                      const isPlanning = data.name === 'Planning';
                      const isTodo = data.name.startsWith('todo_');
                      return (
                        <div
                          key={index}
                          className="text-xs text-muted-foreground flex items-start gap-2"
                        >
                          <div
                            className={`w-1 h-1 rounded-full mt-2 flex-shrink-0 ${
                              isPlanning ? 'bg-blue-500' : isTodo ? 'bg-green-500' : 'bg-primary'
                            }`}
                          />
                          <div className="flex-1">
                            <span
                              className={`font-medium ${
                                isPlanning ? 'text-blue-400' : isTodo ? 'text-green-400' : ''
                              }`}
                            >
                              {isPlanning ? 'Planning' : data.name}:
                            </span>{' '}
                            {isPlanning
                              ? data.description.replace('Planning: ', '')
                              : data.description}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Usage Stats */}
      {(sessionPromptTokens > 0 ||
        sessionCompletionTokens > 0 ||
        totalPromptTokens > 0 ||
        totalCompletionTokens > 0) && (
        <div className="px-4 py-2 border-t bg-muted/50">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <div className="flex items-center gap-3">
              {sessionPromptTokens > 0 && <span>in: {sessionPromptTokens.toLocaleString()}</span>}
              {sessionCompletionTokens > 0 && (
                <span>out: {sessionCompletionTokens.toLocaleString()}</span>
              )}
            </div>
            {(totalPromptTokens > 0 || totalCompletionTokens > 0) && (
              <div className="flex items-center gap-3">
                <span>Total:</span>
                {totalPromptTokens > 0 && <span>in: {totalPromptTokens.toLocaleString()}</span>}
                {totalCompletionTokens > 0 && (
                  <span>out: {totalCompletionTokens.toLocaleString()}</span>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleResetTotalUsage}
                  className="h-4 w-4 p-0"
                  title="Reset total usage counters"
                >
                  <RotateCcw className="h-3 w-3" />
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TODO List */}
      {todoItems.length > 0 && (
        <div className="px-4 py-2 border-t bg-muted/30">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Task Progress
            </h3>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                setTodoItems((prev) => prev.filter((todo) => todo.status !== 'completed'))
              }
              className="h-6 w-6 p-0"
              title="Clear completed tasks"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
          <div className="space-y-1 max-h-40 overflow-y-auto">
            {todoItems.map((todo) => (
              <div
                key={todo.id}
                className={`flex items-start gap-2 p-2 rounded text-xs ${
                  todo.status === 'completed'
                    ? 'bg-green-500/10 border border-green-500/20'
                    : todo.status === 'in_progress'
                      ? 'bg-blue-500/10 border border-blue-500/20'
                      : 'bg-muted/50 border border-border'
                }`}
              >
                <div
                  className={`w-2 h-2 rounded-full mt-1 flex-shrink-0 ${
                    todo.status === 'completed'
                      ? 'bg-green-500'
                      : todo.status === 'in_progress'
                        ? 'bg-blue-500'
                        : todo.priority === 'urgent'
                          ? 'bg-red-500'
                          : todo.priority === 'high'
                            ? 'bg-orange-500'
                            : 'bg-gray-400'
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="font-medium truncate">{todo.title}</div>
                  <div className="flex items-center gap-2 mt-1 text-muted-foreground">
                    <span
                      className={`px-1 py-0.5 rounded text-xs ${
                        todo.priority === 'urgent'
                          ? 'bg-red-500/20 text-red-400'
                          : todo.priority === 'high'
                            ? 'bg-orange-500/20 text-orange-400'
                            : todo.priority === 'medium'
                              ? 'bg-yellow-500/20 text-yellow-400'
                              : 'bg-gray-500/20 text-gray-400'
                      }`}
                    >
                      {todo.priority}
                    </span>
                    <span
                      className={`px-1 py-0.5 rounded text-xs ${
                        todo.status === 'completed'
                          ? 'bg-green-500/20 text-green-400'
                          : todo.status === 'in_progress'
                            ? 'bg-blue-500/20 text-blue-400'
                            : 'bg-gray-500/20 text-gray-400'
                      }`}
                    >
                      {todo.status.replace('_', ' ')}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t">
        <div className="relative w-full">
          <Input
            type="text"
            placeholder={hasKey ? 'Ask me anything...' : 'Enter API key in settings to start'}
            className="w-full pr-20 h-12"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) handleSend();
            }}
            disabled={!hasKey || loading}
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex space-x-1">
            <Button
              size="sm"
              variant={isRecording ? 'destructive' : 'outline'}
              onClick={toggleRecording}
              disabled={!hasKey || loading}
              className="h-8 w-8 p-0"
              title={isRecording ? 'Stop voice input' : 'Start voice input'}
            >
              {isRecording ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </Button>
            <Button
              size="sm"
              onClick={loading ? cancelRequest : handleSend}
              disabled={!hasKey}
              className="h-8"
            >
              {loading ? <Square className="h-4 w-4" /> : 'Send'}
            </Button>
          </div>
        </div>
        {selectedPrompt && (
          <div className="mt-2 text-xs text-muted-foreground">
            Using: {promptTypes.find((p) => p.id === selectedPrompt)?.name}
          </div>
        )}
      </div>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <Card className="w-[420px] max-w-[90vw] p-4 space-y-3">
            <div className="text-lg font-semibold">Settings</div>
            <div className="space-y-2">
              <label className="text-sm">xAI API Key</label>
              <Input
                type="password"
                placeholder="xai-..."
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Get your API key from{' '}
                <a
                  href="https://console.x.ai/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  xAI Console
                </a>
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm">xAI Model</label>
              <select
                className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
              >
                <option value="grok-4-fast">grok-4-fast</option>
                <option value="grok-4-fast-reasoning">grok-4-fast-reasoning</option>
                <option value="grok-4-code-fast">grok-4-code-fast</option>
                <option value="grok-4o">grok-4o</option>
                <option value="grok-4o-mini">grok-4o-mini</option>
                <option value="grok-2">grok-2</option>
                <option value="grok-2-mini">grok-2-mini</option>
                <option value="grok-vision-beta">grok-vision-beta</option>
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm">Live Search</label>
              <select
                className="w-full h-10 rounded-md border bg-background px-3 text-sm"
                value={liveSearchMode}
                onChange={(e) => setLiveSearchMode(e.target.value as any)}
              >
                <option value="auto">Auto</option>
                <option value="on">On</option>
                <option value="off">Off</option>
              </select>
              <p className="text-xs text-muted-foreground">
                Controls semantic live search behavior.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button variant="secondary" onClick={() => setIsSettingsOpen(false)}>
                Cancel
              </Button>
              <Button onClick={saveSettings}>Save</Button>
            </div>
          </Card>
        </div>
      )}

      {/* Conversation History Modal */}
      {showHistory && (
        <ConversationHistory
          conversations={conversationHistory}
          currentConversationId={conversationId}
          onSelectConversation={handleSelectConversation}
          onDeleteConversation={handleDeleteConversation}
          onClearAll={handleClearAllConversations}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}

export default App;
