# Prism Chat

A ChatGPT-style AI chat app with an Apple-inspired glass interface and a multicolor accent. No build step, no dependencies: plain HTML, CSS, and JavaScript.

## Features

- Streaming replies with a stop button and regenerate
- Works with **OpenAI**, **Anthropic**, **Google Gemini**, or any **OpenAI-compatible** server (Ollama, Groq, OpenRouter, LM Studio)
- API settings panel: provider, key, model, base URL, system prompt, creativity
- Conversation history saved in your browser
- Markdown rendering with code blocks and copy buttons
- Light and dark mode that follows your system
- Responsive layout for phones, tablets, and desktops

## Run it

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

Click **API settings**, choose a provider, paste your key, and save.

## Deploy on GitHub Pages

1. Push this folder to a GitHub repository.
2. Go to **Settings > Pages**, choose the `main` branch and the `/ (root)` folder, then save.
3. Open the published URL and add your key in **API settings**.

## About API keys (please read)

This is a static app, so requests go from the visitor's browser straight to the provider.

- Keys you type in **API settings** are stored only in that browser's `localStorage`.
- **Never commit a real key.** `config.js` and `.env` are in `.gitignore`.
- Optional local defaults: copy `config.example.js` to `config.js` and fill it in. Anything in `config.js` is readable by whoever loads the page, so use it for local development only, never for a public deployment.
- If you want a shared public site that uses *your* key, put a small backend proxy in front of the provider so the key stays on the server.
- Anthropic requests use the `anthropic-dangerous-direct-browser-access` header, which is what makes direct browser calls possible. That is fine for your own key on your own device.

## Project structure

```
index.html            page structure and settings dialog
css/style.css         design tokens, glass panels, multicolor ring
js/app.js             providers, streaming, chat history, settings
config.example.js     optional local defaults (copy to config.js)
```

## Adding a provider

Add an entry to `PROVIDERS` and a streaming function to `STREAMERS` in `js/app.js`. Each streamer is an async generator that yields text chunks.

## License

MIT
