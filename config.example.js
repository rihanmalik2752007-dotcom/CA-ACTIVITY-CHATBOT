// Optional local defaults. Copy this file to `config.js` (it is git-ignored)
// and fill in your key. Never commit config.js or put a real key in this example.
//
// NOTE: this is a static site, so anything in config.js is readable by the
// browser. Use it for local development only, not for a public deployment.
window.PRISM_CONFIG = {
  provider: 'gemini', // 'openai' | 'anthropic' | 'gemini' | 'custom'
  providers: {
    gemini: { apiKey: 'YOUR_KEY_HERE', model: 'gemini-3.8-flash' },
    // openai:    { apiKey: 'YOUR_KEY_HERE', model: 'gpt-4o-mini' },
    // anthropic: { apiKey: 'YOUR_KEY_HERE', model: 'claude-sonnet-5-5' },
    // custom:    { baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' },
  },
};
