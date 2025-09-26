import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

const TOOL_SLOTS = [
  'tool_shortcut_1',
  'tool_shortcut_2',
  'tool_shortcut_3',
  'tool_shortcut_4',
  'tool_shortcut_5',
];

function OptionsApp() {
  const [mappings, setMappings] = useState<Record<string, { toolName: string; args?: any }>>({});
  const [availableTools, setAvailableTools] = useState<string[]>([]);

  useEffect(() => {
    // Load existing mappings
    (async () => {
      const keys = TOOL_SLOTS.map((s) => `shortcut_mapping_${s}`);
      const stored = await chrome.storage.local.get(keys);
      const initial: any = {};
      TOOL_SLOTS.forEach((s) => {
        const k = `shortcut_mapping_${s}`;
        initial[s] = stored[k] || { toolName: '' };
      });
      setMappings(initial);

      // Derive available tools from shared schema if available
      try {
        const mod = await import('chrome-mcp-shared');
        const TOOL_SCHEMAS = mod.TOOL_SCHEMAS || [];
        setAvailableTools(TOOL_SCHEMAS.map((t: any) => t.name));
      } catch (e) {
        // fallback: basic list
        setAvailableTools(['open_url', 'take_screenshot', 'search_page']);
      }
    })();
  }, []);

  const updateSlot = (slot: string, toolName: string) => {
    setMappings((m) => ({ ...m, [slot]: { ...m[slot], toolName } }));
  };

  const save = async () => {
    const toStore: Record<string, any> = {};
    Object.keys(mappings).forEach((slot) => {
      toStore[`shortcut_mapping_${slot}`] = mappings[slot];
    });
    await chrome.storage.local.set(toStore);
    alert('Saved');
  };

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, sans-serif', width: 600 }}>
      <h2>Keyboard shortcut tool mappings</h2>
      <p>
        Assign a tool name to each shortcut slot. Then go to Chrome Extensions &gt; Keyboard
        shortcuts to bind keys.
      </p>
      <div style={{ display: 'grid', gap: 12 }}>
        {TOOL_SLOTS.map((slot) => (
          <div key={slot} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{ width: 180, fontWeight: 600 }}>{slot}</div>
            <select
              value={mappings[slot]?.toolName || ''}
              onChange={(e) => updateSlot(slot, e.target.value)}
            >
              <option value="">-- none --</option>
              {availableTools.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <input
              placeholder="optional JSON args"
              style={{ flex: 1 }}
              value={mappings[slot]?.args ? JSON.stringify(mappings[slot].args) : ''}
              onChange={(e) => {
                try {
                  const parsed = e.target.value ? JSON.parse(e.target.value) : undefined;
                  setMappings((m) => ({
                    ...m,
                    [slot]: { toolName: m[slot]?.toolName || '', args: parsed },
                  }));
                } catch (err) {
                  // ignore parse errors for now
                }
              }}
            />
          </div>
        ))}
      </div>
      <div style={{ marginTop: 16 }}>
        <button onClick={save}>Save mappings</button>
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<OptionsApp />);
