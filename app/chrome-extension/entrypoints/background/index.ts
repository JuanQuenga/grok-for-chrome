import { BACKGROUND_MESSAGE_TYPES } from '@/common/message-types';
import { handleCallTool } from './tools';
import {
  initSemanticSimilarityListener,
  initializeSemanticEngineIfCached,
} from './semantic-similarity';
import { initStorageManagerListener } from './storage-manager';
import { cleanupModelCache } from '@/utils/semantic-similarity-engine';

/**
 * Background script entry point
 * Initializes all background services and listeners
 */
export default defineBackground(() => {
  // Initialize core services
  initSemanticSimilarityListener();
  initStorageManagerListener();

  // Initialize sidepanel
  chrome.runtime.onInstalled.addListener(() => {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  });

  // Handle keyboard shortcuts and tool shortcut slots
  chrome.commands.onCommand.addListener(async (command, tab) => {
    const openSidepanelForTab = async (t?: chrome.tabs.Tab) => {
      if (t?.id) {
        await chrome.sidePanel.open({ tabId: t.id });
      } else {
        const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tabs[0]?.id) await chrome.sidePanel.open({ tabId: tabs[0].id });
      }
    };

    if (command === 'open_sidepanel') {
      await openSidepanelForTab(tab as any);
      return;
    }

    if (command === 'open_popup') {
      if (chrome.action && chrome.action.openPopup) {
        await chrome.action
          .openPopup()
          .catch((error) => console.warn('Failed to open popup programmatically:', error));
      }
      return;
    }

    // Tool shortcut slots: look up mapping in storage and execute mapped tool
    if (command.startsWith('tool_shortcut_')) {
      try {
        const mappingKey = `shortcut_mapping_${command}`;
        const result = await chrome.storage.local.get([mappingKey]);
        const mapped = result?.[mappingKey];
        if (mapped && mapped.toolName) {
          // Execute the mapped tool via existing handleCallTool helper
          handleCallTool({ name: mapped.toolName, args: mapped.args || {} });
        } else {
          console.log(`No tool mapped for ${command}`);
        }
      } catch (error) {
        console.warn('Failed to handle tool shortcut command:', error);
      }
    }
  });

  // Conditionally initialize semantic similarity engine if model cache exists
  initializeSemanticEngineIfCached()
    .then((initialized) => {
      if (initialized) {
        console.log('Background: Semantic similarity engine initialized from cache');
      } else {
        console.log(
          'Background: Semantic similarity engine initialization skipped (no cache found)',
        );
      }
    })
    .catch((error) => {
      console.warn('Background: Failed to conditionally initialize semantic engine:', error);
    });

  // Initial cleanup on startup
  cleanupModelCache().catch((error) => {
    console.warn('Background: Initial cache cleanup failed:', error);
  });

  // Proxy: allow sidepanel/popup to execute tools via background
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === BACKGROUND_MESSAGE_TYPES.EXECUTE_TOOL) {
      handleCallTool({ name: message.name, args: message.args })
        .then((result) => sendResponse({ success: true, result }))
        .catch((error) => sendResponse({ success: false, error: error?.message || String(error) }));
      return true;
    }
  });
});
