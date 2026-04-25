"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  getAssistantStatus,
  sendAssistantMessage,
  type AssistantMessage,
  type AssistantStatus,
} from "@/lib/api";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles, Send, Loader2, Bot, User, RefreshCw, AlertTriangle,
} from "lucide-react";

const SUGGESTIONS = [
  "Wat is de totale inkoopwaarde van onze voorraad?",
  "Welke 5 merken hebben de hoogste voorraadwaarde?",
  "Welke producten hebben minder dan 5 stuks op voorraad?",
  "Hoeveel verschillende producten verkopen we via InterCars?",
  "Welke categorieën zijn het sterkst vertegenwoordigd?",
];

export default function AssistantPage() {
  const [status, setStatus] = useState<AssistantStatus | null>(null);
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getAssistantStatus()
      .then(setStatus)
      .catch(() => setStatus({ provider: "none", model: "", available: false }));
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    const next: AssistantMessage[] = [...messages, { role: "user", content: trimmed }];
    setMessages(next);
    setInput("");
    setSending(true);
    setError(null);

    try {
      const res = await sendAssistantMessage(next);
      setMessages([...next, { role: "assistant", content: res.reply }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Antwoord mislukt");
      // Roll back the optimistic user message so they can retry from the
      // input without typing again.
      setMessages(next.slice(0, -1));
      setInput(trimmed);
    } finally {
      setSending(false);
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    void send(input);
  }

  function reset() {
    setMessages([]);
    setError(null);
    setInput("");
  }

  return (
    <div className="space-y-4 w-full max-w-4xl mx-auto h-[calc(100vh-8rem)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" /> OEMLine Assistant
          </h2>
          <p className="text-muted-foreground text-sm">
            Stel vragen over voorraad, producten, merken en categorieën. De assistent gebruikt actuele dashboard-data.
          </p>
        </div>
        <div className="flex items-center gap-2 self-start">
          {status && (
            <Badge variant={status.available ? "success" : "destructive"} className="gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${status.available ? "bg-emerald-300" : "bg-red-300"}`} />
              {status.available ? `${status.provider} · ${status.model}` : "Geen LLM beschikbaar"}
            </Badge>
          )}
          {messages.length > 0 && (
            <Button variant="outline" size="sm" onClick={reset} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" /> Nieuw gesprek
            </Button>
          )}
        </div>
      </div>

      {/* Status warning when LLM not configured */}
      {status && !status.available && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>
            Er is geen LLM-provider geconfigureerd. Stel <code>KIMI_API_KEY</code> in of zorg dat <code>OLLAMA_URL</code> bereikbaar is voor de API-service.
          </div>
        </div>
      )}

      {/* Conversation */}
      <Card className="flex-1 flex flex-col min-h-0">
        <CardContent className="p-0 flex-1 flex flex-col min-h-0">
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center px-6 py-10 text-sm text-muted-foreground">
                <Bot className="h-10 w-10 text-muted-foreground/40 mb-3" />
                <p className="font-medium text-foreground mb-2">Waarmee kan ik je helpen?</p>
                <p className="mb-6 max-w-md">
                  Vraag iets over je catalogus, voorraad of business-cijfers — de assistent kijkt in de huidige dashboard-context.
                </p>
                <div className="flex flex-wrap gap-2 justify-center max-w-2xl">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => void send(s)}
                      disabled={!status?.available || sending}
                      className="rounded-full border bg-background px-3 py-1.5 text-xs hover:border-primary hover:bg-primary/5 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => <ChatBubble key={i} message={m} />)
            )}
            {sending && (
              <div className="flex items-start gap-3 max-w-3xl">
                <div className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Bot className="h-4 w-4" />
                </div>
                <div className="rounded-2xl rounded-tl-sm bg-muted px-4 py-2.5 text-sm text-muted-foreground inline-flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> denkt na…
                </div>
              </div>
            )}
            {error && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" /> {error}
              </div>
            )}
          </div>

          {/* Input */}
          <form onSubmit={handleSubmit} className="border-t p-3 flex gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={status?.available ? "Stel een vraag…" : "Niet beschikbaar — controleer LLM-config"}
              disabled={!status?.available || sending}
              className="flex-1 rounded-md border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-50"
              autoFocus
            />
            <Button type="submit" disabled={!status?.available || sending || !input.trim()} className="gap-1.5">
              {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Verzend
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function ChatBubble({ message }: { message: AssistantMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={`flex items-start gap-3 max-w-3xl ${isUser ? "ml-auto flex-row-reverse" : ""}`}>
      <div
        className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
          isUser ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary"
        }`}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      <div
        className={`rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
          isUser
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-muted text-foreground rounded-tl-sm"
        }`}
      >
        {message.content}
      </div>
    </div>
  );
}
