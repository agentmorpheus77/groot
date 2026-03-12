import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { useParams, useNavigate } from "react-router-dom"
import { MessageSquare, Send, Trash2, Bot, User, Loader2, Settings } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { listModels, chatWithModel, type Model } from "@/api"
import { cn } from "@/lib/utils"

interface Message {
  role: "user" | "assistant"
  content: string
  error?: boolean
  modelName?: string
}

export default function Chat() {
  const { t } = useTranslation()
  const { modelId } = useParams()
  const navigate = useNavigate()

  const LUTZ_DEFAULT_PROMPT = "Du bist ein freundlicher, kompetenter Assistent für LUTZ-JESCO GmbH. Du hilfst Mitarbeitern und Kunden bei Fragen rund um Produkte, Prozesse und das Unternehmen. Antworte immer auf Deutsch, klar und verständlich. Halte deine Antworten kurz und direkt. Wenn du etwas nicht weißt, sage es ehrlich. Antworte NIEMALS im Format eines Wissensgraphen oder mit technischen Metadaten."

  const [models, setModels] = useState<Model[]>([])
  const [selectedModelId, setSelectedModelId] = useState<string>(modelId || "")
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [maxTokens, setMaxTokens] = useState(256)
  const [showSettings, setShowSettings] = useState(false)
  const [systemPrompt, setSystemPrompt] = useState(LUTZ_DEFAULT_PROMPT)
  const [showSystemPrompt, setShowSystemPrompt] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    listModels().then(r => setModels(r.data)).catch(console.error)
  }, [])

  useEffect(() => {
    if (modelId) setSelectedModelId(modelId)
  }, [modelId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const selectedModel = models.find(m => String(m.id) === selectedModelId)

  const handleSend = async () => {
    if (!input.trim() || !selectedModelId || loading) return

    const userMsg: Message = { role: "user", content: input.trim() }
    setMessages(prev => [...prev, userMsg])
    setInput("")
    setLoading(true)

    try {
      const r = await chatWithModel(parseInt(selectedModelId), userMsg.content, maxTokens, systemPrompt)
      setMessages(prev => [...prev, {
        role: "assistant",
        content: r.data.response,
        modelName: r.data.model_name,
      }])
    } catch (e: any) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: e.response?.data?.detail || t("chat.message.error"),
        error: true,
        modelName: selectedModel?.name,
      }])
    } finally {
      setLoading(false)
      textareaRef.current?.focus()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)] animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-violet-500/10 border border-violet-500/20">
            <MessageSquare className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold">{t("chat.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("chat.subtitle")}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Model selector */}
          <Select value={selectedModelId} onValueChange={v => {
            setSelectedModelId(v)
            navigate(`/chat/${v}`)
          }}>
            <SelectTrigger className="w-56 h-9 text-sm">
              <SelectValue placeholder={t("chat.selectModelPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {models.length === 0 ? (
                <div className="py-2 px-2 text-sm text-muted-foreground">{t("chat.noModels")}</div>
              ) : models.map(m => (
                <SelectItem key={m.id} value={String(m.id)}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Button variant="ghost" size="icon" className="h-9 w-9" title="System Prompt"
            onClick={() => setShowSystemPrompt(!showSystemPrompt)}>
            <Bot className="w-4 h-4" />
          </Button>

          <Button variant="ghost" size="icon" className="h-9 w-9"
            onClick={() => setShowSettings(!showSettings)}>
            <Settings className="w-4 h-4" />
          </Button>

          {messages.length > 0 && (
            <Button variant="ghost" size="icon" className="h-9 w-9"
              onClick={() => setMessages([])} title={t("chat.clearHistory")}>
              <Trash2 className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* System Prompt panel */}
      {showSystemPrompt && (
        <Card className="glass-card mb-4 shrink-0">
          <CardContent className="p-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">System Prompt</Label>
                <Button variant="ghost" size="sm" className="h-6 text-xs px-2"
                  onClick={() => setSystemPrompt(LUTZ_DEFAULT_PROMPT)}>
                  Reset
                </Button>
              </div>
              <Textarea
                value={systemPrompt}
                onChange={e => setSystemPrompt(e.target.value)}
                className="text-xs min-h-[80px] font-mono"
                rows={4}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Settings panel */}
      {showSettings && (
        <Card className="glass-card mb-4 shrink-0">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">
                  {t("chat.maxTokens")}
                </Label>
                <Input
                  type="number"
                  min={32}
                  max={2048}
                  step={32}
                  value={maxTokens}
                  onChange={e => setMaxTokens(parseInt(e.target.value) || 256)}
                  className="w-24 h-7 text-xs"
                />
              </div>
              {selectedModel && (
                <>
                  <Separator orientation="vertical" className="h-6" />
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Model:</span>
                    <Badge variant="outline" className="text-xs">{selectedModel.base_model.split("/")[1]}</Badge>
                    {selectedModel.final_loss != null && (
                      <Badge variant="success" className="text-xs">Loss: {selectedModel.final_loss.toFixed(4)}</Badge>
                    )}
                  </div>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Chat area */}
      <Card className="glass-card flex-1 flex flex-col min-h-0">
        {/* Messages */}
        <ScrollArea className="flex-1 p-4">
          {!selectedModelId ? (
            <div className="flex flex-col items-center justify-center h-full py-12 text-center">
              <MessageSquare className="w-12 h-12 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">{t("chat.noModel")}</p>
              {models.length === 0 && (
                <Button variant="outline" size="sm" className="mt-3" onClick={() => navigate("/training")}>
                  {t("chat.noModels")}
                </Button>
              )}
            </div>
          ) : messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-12 text-center">
              <div className="w-14 h-14 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center mb-4">
                <Bot className="w-7 h-7 text-primary" />
              </div>
              <p className="font-medium">{selectedModel?.name}</p>
              <p className="text-sm text-muted-foreground mt-1">{t("chat.emptyState")}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex gap-3",
                    msg.role === "user" ? "justify-end" : "justify-start"
                  )}
                >
                  {msg.role === "assistant" && (
                    <div className="flex items-start justify-center w-7 h-7 rounded-full bg-primary/15 border border-primary/20 shrink-0 mt-0.5">
                      <Bot className="w-4 h-4 text-primary mt-1.5" />
                    </div>
                  )}
                  <div
                    className={cn(
                      "max-w-[75%] rounded-2xl px-4 py-2.5 text-sm",
                      msg.role === "user"
                        ? "bg-primary text-primary-foreground rounded-tr-sm"
                        : msg.error
                        ? "bg-destructive/10 border border-destructive/30 text-destructive-foreground rounded-tl-sm"
                        : "bg-muted rounded-tl-sm"
                    )}
                  >
                    {msg.role === "assistant" && msg.modelName && (
                      <p className="text-[10px] text-muted-foreground mb-1">{msg.modelName}</p>
                    )}
                    <p className="whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  </div>
                  {msg.role === "user" && (
                    <div className="flex items-start justify-center w-7 h-7 rounded-full bg-secondary border border-border shrink-0 mt-0.5">
                      <User className="w-4 h-4 text-muted-foreground mt-1.5" />
                    </div>
                  )}
                </div>
              ))}
              {loading && (
                <div className="flex gap-3 justify-start">
                  <div className="flex items-start justify-center w-7 h-7 rounded-full bg-primary/15 border border-primary/20 shrink-0 mt-0.5">
                    <Bot className="w-4 h-4 text-primary mt-1.5" />
                  </div>
                  <div className="bg-muted rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">{t("chat.message.thinking")}</span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </ScrollArea>

        {/* Input */}
        <div className="p-4 border-t border-border shrink-0">
          <div className="flex gap-2">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={selectedModelId ? t("chat.input.placeholder") : t("chat.noModel")}
              disabled={!selectedModelId || loading}
              className="min-h-[44px] max-h-32 resize-none text-sm"
              rows={1}
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || !selectedModelId || loading}
              size="icon"
              className="h-11 w-11 shrink-0"
            >
              {loading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Send className="w-4 h-4" />
              }
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5 text-right">
            Enter = Senden · Shift+Enter = Neue Zeile
          </p>
        </div>
      </Card>
    </div>
  )
}
