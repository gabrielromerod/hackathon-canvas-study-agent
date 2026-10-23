export function createModelBridge(api, onEvent = () => {}) {
  let creating;
  async function ensure() {
    if (creating) return creating;
    creating = (async () => {
      const contexts = await api.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [api.runtime.getURL('offscreen.html')],
      });
      if (!contexts.length)
        await api.offscreen.createDocument({
          url: 'offscreen.html',
          reasons: ['WORKERS'],
          justification: 'Run the on-device WebGPU model in a shared worker.',
        });
    })().finally(() => {
      creating = null;
    });
    return creating;
  }
  api.runtime.onMessage.addListener((message, sender) => {
    if (sender.id === api.runtime.id && message.target === 'ai-event')
      onEvent(message.event, message.data, message.id);
  });
  return {
    async rpc(method, payload = {}, id = crypto.randomUUID()) {
      await ensure();
      const response = await api.runtime.sendMessage({ target: 'ai-worker', id, method, payload });
      if (!response)
        throw new Error('The model host did not respond. Please reload the extension.');
      if (response.error) throw new Error(response.error);
      return response.data;
    },
  };
}
