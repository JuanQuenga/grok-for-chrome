import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Database,
  FileText,
  TabletSmartphone,
  Box,
  Zap,
  Trash2,
  Check,
  AlertCircle,
  RotateCcw,
  Settings,
} from 'lucide-react';

interface ModelInfo {
  preset: string;
  performance: 'fast' | 'balanced' | 'accurate';
  size: string;
  dimension: number;
  description: string;
}

interface StorageStats {
  indexedPages: number;
  totalDocuments: number;
  totalTabs: number;
  indexSize: number;
  isInitialized: boolean;
}

interface SemanticEngineState {
  status: 'idle' | 'initializing' | 'ready' | 'error';
  lastUpdated: number | null;
  progress: string;
}

const availableModels: ModelInfo[] = [
  {
    preset: 'multilingual-e5-small',
    performance: 'fast',
    size: '118MB',
    dimension: 384,
    description: 'Lightweight model for quick processing',
  },
  {
    preset: 'multilingual-e5-base',
    performance: 'balanced',
    size: '278MB',
    dimension: 768,
    description: 'Better performance than small model',
  },
];

export default function App() {
  const [currentModel, setCurrentModel] = useState<string>('multilingual-e5-small');
  const [storageStats, setStorageStats] = useState<StorageStats>({
    indexedPages: 0,
    totalDocuments: 0,
    totalTabs: 0,
    indexSize: 0,
    isInitialized: false,
  });
  const [semanticEngine, setSemanticEngine] = useState<SemanticEngineState>({
    status: 'idle',
    lastUpdated: null,
    progress: '',
  });
  const [isModelSwitching, setIsModelSwitching] = useState(false);
  const [isClearingData, setIsClearingData] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [modelProgress, setModelProgress] = useState(0);

  const pollingInterval = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    loadInitialData();
    return () => {
      if (pollingInterval.current) {
        clearInterval(pollingInterval.current);
      }
    };
  }, []);

  const loadInitialData = async () => {
    try {
      // Load model preferences
      const result = await chrome.storage.local.get(['selectedModel', 'semanticEngineState']);
      if (result.selectedModel) {
        setCurrentModel(result.selectedModel);
      }
      if (result.semanticEngineState) {
        setSemanticEngine(result.semanticEngineState);
      }

      // Load storage stats
      await refreshStorageStats();
      await checkSemanticEngineStatus();
    } catch (error) {
      console.error('Failed to load initial data:', error);
    }
  };

  const refreshStorageStats = async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'get_storage_stats',
      });

      if (response?.success) {
        setStorageStats({
          indexedPages: response.stats.indexedPages || 0,
          totalDocuments: response.stats.totalDocuments || 0,
          totalTabs: response.stats.totalTabs || 0,
          indexSize: response.stats.indexSize || 0,
          isInitialized: response.stats.isInitialized || false,
        });
      }
    } catch (error) {
      console.error('Failed to refresh storage stats:', error);
    }
  };

  const checkSemanticEngineStatus = async () => {
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'GET_MODEL_STATUS',
      });

      if (response?.success && response.status) {
        const status = response.status.initializationStatus;
        setSemanticEngine((prev) => ({
          ...prev,
          status:
            status === 'ready'
              ? 'ready'
              : status === 'initializing' || status === 'downloading'
                ? 'initializing'
                : status === 'error'
                  ? 'error'
                  : 'idle',
          lastUpdated: Date.now(),
        }));
      }
    } catch (error) {
      console.error('Failed to check semantic engine status:', error);
    }
  };

  const initializeSemanticEngine = async () => {
    if (semanticEngine.status === 'initializing') return;

    setSemanticEngine((prev) => ({
      ...prev,
      status: 'initializing',
      progress: 'Initializing semantic engine...',
      lastUpdated: Date.now(),
    }));

    try {
      await chrome.runtime.sendMessage({
        type: 'INITIALIZE_SEMANTIC_ENGINE',
      });

      // Start polling for status updates
      pollingInterval.current = setInterval(checkSemanticEngineStatus, 2000);
    } catch (error) {
      console.error('Failed to initialize semantic engine:', error);
      setSemanticEngine((prev) => ({
        ...prev,
        status: 'error',
        progress: 'Failed to initialize',
      }));
    }
  };

  const switchModel = async (modelPreset: string) => {
    if (isModelSwitching || modelPreset === currentModel) return;

    setIsModelSwitching(true);
    setModelProgress(0);

    try {
      const model = availableModels.find((m) => m.preset === modelPreset);
      if (!model) throw new Error('Model not found');

      // Save preference
      await chrome.storage.local.set({ selectedModel: modelPreset });

      const response = await chrome.runtime.sendMessage({
        type: 'switch_semantic_model',
        modelPreset,
        modelVersion: 'quantized',
        modelDimension: model.dimension,
      });

      if (response?.success) {
        setCurrentModel(modelPreset);
        setModelProgress(100);
        setTimeout(() => setModelProgress(0), 2000);
      } else {
        throw new Error(response?.error || 'Model switch failed');
      }
    } catch (error) {
      console.error('Model switch failed:', error);
    } finally {
      setIsModelSwitching(false);
    }
  };

  const clearAllData = async () => {
    if (isClearingData) return;

    setIsClearingData(true);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'clear_all_data',
      });

      if (response?.success) {
        await refreshStorageStats();
        setShowClearConfirm(false);
      } else {
        throw new Error(response?.error || 'Failed to clear data');
      }
    } catch (error) {
      console.error('Failed to clear data:', error);
    } finally {
      setIsClearingData(false);
    }
  };

  const formatSize = (bytes: number): string => {
    const mb = Math.round(bytes / (1024 * 1024));
    return `${mb} MB`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'ready':
        return 'bg-green-500';
      case 'initializing':
        return 'bg-yellow-500';
      case 'error':
        return 'bg-red-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'ready':
        return 'Engine Ready';
      case 'initializing':
        return 'Initializing...';
      case 'error':
        return 'Error';
      default:
        return 'Not Initialized';
    }
  };

  const getPerformanceColor = (performance: string) => {
    switch (performance) {
      case 'fast':
        return 'bg-green-100 text-green-800';
      case 'balanced':
        return 'bg-blue-100 text-blue-800';
      case 'accurate':
        return 'bg-purple-100 text-purple-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  return (
    <div className="w-96 max-h-[600px] bg-background">
      {/* Header */}
      <div className="p-6 pb-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-foreground">Chrome MCP Server</h1>
          <Button variant="ghost" size="icon">
            <Settings className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="px-6 pb-6 space-y-6 overflow-y-auto max-h-[500px]">
        {/* Semantic Engine Status */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Semantic Engine
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${getStatusColor(semanticEngine.status)}`} />
              <span className="font-medium">{getStatusText(semanticEngine.status)}</span>
              {semanticEngine.lastUpdated && (
                <span className="text-xs text-muted-foreground ml-auto">
                  {new Date(semanticEngine.lastUpdated).toLocaleTimeString()}
                </span>
              )}
            </div>

            {semanticEngine.status === 'initializing' && semanticEngine.progress && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  {semanticEngine.progress}
                </div>
              </div>
            )}

            <Button
              onClick={initializeSemanticEngine}
              disabled={semanticEngine.status === 'initializing'}
              className="w-full"
            >
              <Zap className="w-4 h-4 mr-2" />
              {semanticEngine.status === 'ready' ? 'Reinitialize' : 'Initialize'} Engine
            </Button>
          </CardContent>
        </Card>

        {/* Model Selection */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Embedding Model
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {isModelSwitching && (
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                  Switching model...
                </div>
                <Progress value={modelProgress} className="h-1" />
              </div>
            )}

            <div className="space-y-3">
              {availableModels.map((model) => (
                <div
                  key={model.preset}
                  onClick={() => switchModel(model.preset)}
                  className={`p-3 rounded-lg border cursor-pointer transition-colors ${
                    currentModel === model.preset
                      ? 'border-primary bg-primary/5'
                      : 'border-border hover:border-primary/50'
                  } ${isModelSwitching ? 'opacity-50 pointer-events-none' : ''}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3
                          className={`font-medium ${
                            currentModel === model.preset ? 'text-primary' : 'text-foreground'
                          }`}
                        >
                          {model.preset}
                        </h3>
                        {currentModel === model.preset && (
                          <Check className="w-4 h-4 text-primary" />
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">{model.description}</p>
                      <div className="flex gap-2 mt-2">
                        <Badge
                          variant="secondary"
                          className={getPerformanceColor(model.performance)}
                        >
                          {model.performance}
                        </Badge>
                        <Badge variant="outline">{model.size}</Badge>
                        <Badge variant="outline">{model.dimension}D</Badge>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Storage Statistics */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Index Data Management
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Indexed Pages</span>
                  <div className="p-1 bg-purple-100 text-purple-600 rounded">
                    <FileText className="w-3 h-3" />
                  </div>
                </div>
                <p className="text-2xl font-bold">{storageStats.indexedPages}</p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Index Size</span>
                  <div className="p-1 bg-teal-100 text-teal-600 rounded">
                    <Database className="w-3 h-3" />
                  </div>
                </div>
                <p className="text-2xl font-bold">{formatSize(storageStats.indexSize)}</p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Active Tabs</span>
                  <div className="p-1 bg-blue-100 text-blue-600 rounded">
                    <TabletSmartphone className="w-3 h-3" />
                  </div>
                </div>
                <p className="text-2xl font-bold">{storageStats.totalTabs}</p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">Vectors</span>
                  <div className="p-1 bg-green-100 text-green-600 rounded">
                    <Box className="w-3 h-3" />
                  </div>
                </div>
                <p className="text-2xl font-bold">{storageStats.totalDocuments}</p>
              </div>
            </div>

            {isClearingData && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                Clearing data...
              </div>
            )}

            {showClearConfirm ? (
              <div className="space-y-3 p-3 border border-destructive/20 bg-destructive/5 rounded-lg">
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-destructive mt-0.5" />
                  <div className="text-sm">
                    <p className="font-medium text-destructive mb-1">Clear all data?</p>
                    <p className="text-destructive/80">This will permanently delete:</p>
                    <ul className="text-xs text-destructive/70 ml-2 mt-1">
                      <li>• All indexed pages</li>
                      <li>• Vector embeddings</li>
                      <li>• Search indices</li>
                    </ul>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={clearAllData}
                    disabled={isClearingData}
                    variant="destructive"
                    size="sm"
                    className="flex-1"
                  >
                    Clear All Data
                  </Button>
                  <Button
                    onClick={() => setShowClearConfirm(false)}
                    variant="outline"
                    size="sm"
                    className="flex-1"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                onClick={() => setShowClearConfirm(true)}
                disabled={isClearingData}
                variant="outline"
                className="w-full text-destructive border-destructive/20 hover:bg-destructive/5"
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Clear All Data
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Footer */}
      <div className="p-4 border-t">
        <p className="text-center text-xs text-muted-foreground">chrome mcp server for ai</p>
      </div>
    </div>
  );
}
