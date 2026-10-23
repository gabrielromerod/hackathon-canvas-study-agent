import { openRepository } from '../storage/repository.js';
import { createBackgroundHub } from './hub.js';
import { createModelBridge } from '../ai/bridge.js';
const model = createModelBridge(chrome, (event, data, id) => hub.modelEvent(event, data, id));
const hub = createBackgroundHub(chrome, openRepository(), { model });
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
