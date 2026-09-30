import "dotenv/config";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = express();
const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const port = Number.parseInt(process.env.PORT || "3000", 10) || 3000;
const nodeEnvironment = process.env.NODE_ENV || "development";

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const DEFAULT_CHAT = process.env.TELEGRAM_DEFAULT_CHAT_ID || process.env.TELEGRAM_CHAT_ID || "";

app.disable("x-powered-by");

// Configuración de CORS
app.use((req, res, next) => {
    const origin = req.headers.origin;
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
    if (req.method === "OPTIONS") return res.sendStatus(204);
    return next();
});

app.use(express.json({ limit: "64kb" }));

// Estado del servicio
app.get("/health", (_req, res) => {
    res.json({
        ok: true,
        service: "guardian-notifications-api",
        environment: nodeEnvironment,
        telegramConfigured: Boolean(TOKEN)
    });
});

// Endpoint de envío directo de alertas a Telegram
app.post("/api/telegram/send-alert", async (req, res) => {
    if (!TOKEN) {
        return res.status(503).json({ ok: false, error: "TELEGRAM_BOT_TOKEN no configurado en .env" });
    }

    const { title, message, chatId, locationUrl } = req.body;
    const targetChat = chatId || DEFAULT_CHAT;

    if (!targetChat) {
        return res.status(400).json({ ok: false, error: "Falta Chat ID de Telegram" });
    }

    try {
        let text = `🚨 <b>${title || 'ALERTA GUARDIAN'}</b>\n${message || ''}`;
        if (locationUrl) {
            text += `\n\n📌 <a href="${locationUrl}">Ver ubicación en el mapa</a>`;
        }

        const response = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                chat_id: targetChat,
                text: text,
                parse_mode: "HTML",
                disable_web_page_preview: false
            })
        });

        const data = await response.json();
        if (!response.ok || !data.ok) {
            return res.status(502).json({ ok: false, error: data.description || "Error de Telegram" });
        }

        return res.json({ ok: true, sent: true, messageId: data.result.message_id });
    } catch (err) {
        return res.status(502).json({ ok: false, error: "No se pudo contactar a Telegram" });
    }
});

app.use(express.static(projectRoot, { dotfiles: "ignore" }));

export function startServer() {
    return app.listen(port, () => {
        console.log(`Guardian API ejecutándose en http://localhost:${port} (${nodeEnvironment})`);
        console.log(`Estado Telegram: ${TOKEN ? 'CONFIGURADO ✅' : 'SIN TOKEN ❌'}`);
    });
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
    startServer();
}

export default app;