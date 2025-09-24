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

  // Handle keyboard shortcuts
  chrome.commands.onCommand.addListener((command, tab) => {
    if (command === 'open_sidepanel') {
      // Open sidepanel
      if (tab?.id) {
        chrome.sidePanel.open({ tabId: tab.id });
      } else {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0]?.id) {
            chrome.sidePanel.open({ tabId: tabs[0].id });
          }
        });
      }
    } else if (command === 'open_popup') {
      // Open popup - try to use chrome.action.openPopup() if available
      if (chrome.action && chrome.action.openPopup) {
        chrome.action.openPopup().catch((error) => {
          console.warn('Failed to open popup programmatically:', error);
        });
      } else {
        // Fallback: try to simulate opening by creating a temporary window
        // This is a workaround since there's no direct API
        console.log('Popup opening requested - chrome.action.openPopup not available');
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
