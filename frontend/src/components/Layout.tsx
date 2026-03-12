import { Outlet, NavLink, useLocation } from "react-router-dom"
import { useTranslation } from "react-i18next"
import { useTheme } from "next-themes"
import {
  LayoutDashboard, Database, Zap, BookOpen, MessageSquare, Mic,
  Sun, Moon, Globe, TreePine, ChevronRight, Menu, X, Store,
} from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"

const navItems = [
  { path: "/dashboard", icon: LayoutDashboard, labelKey: "nav.dashboard" },
  { path: "/hub",       icon: Store,           labelKey: "nav.hub"       },
  { path: "/datasets",  icon: Database,        labelKey: "nav.datasets"  },
  { path: "/training",  icon: Zap,             labelKey: "nav.training"  },
  { path: "/models",    icon: BookOpen,        labelKey: "nav.models"    },
  { path: "/chat",      icon: MessageSquare,   labelKey: "nav.chat"      },
  { path: "/learnings", icon: BookOpen,        labelKey: "nav.learnings" },
  { path: "/whisper",   icon: Mic,             labelKey: "nav.whisper"   },
]

export default function Layout() {
  const { t, i18n } = useTranslation()
  const { theme, setTheme } = useTheme()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const location = useLocation()

  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark")

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Sidebar */}
      <aside
        className={cn(
          "flex flex-col border-r border-border transition-all duration-300 shrink-0",
          "bg-[hsl(var(--sidebar-background))]",
          sidebarOpen ? "w-56" : "w-16"
        )}
      >
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-border">
          <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/20 shrink-0">
            <TreePine className="w-5 h-5 text-primary" />
          </div>
          {sidebarOpen && (
            <div className="overflow-hidden">
              <p className="font-bold text-sm text-foreground leading-none">{t("app.name")}</p>
              <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{t("app.tagline")}</p>
            </div>
          )}
        </div>

        {/* Nav Items */}
        <nav className="flex-1 px-2 py-4 space-y-1 overflow-y-auto">
          {navItems.map(({ path, icon: Icon, labelKey }) => {
            const isActive = location.pathname.startsWith(path)
            return (
              <NavLink key={path} to={path}>
                <div className={cn(
                  "sidebar-item",
                  isActive && "active",
                  !sidebarOpen && "justify-center px-2"
                )}>
                  <Icon className="w-4 h-4 shrink-0" />
                  {sidebarOpen && (
                    <span className="truncate">{t(labelKey)}</span>
                  )}
                  {sidebarOpen && isActive && (
                    <ChevronRight className="w-3 h-3 ml-auto text-primary" />
                  )}
                </div>
              </NavLink>
            )
          })}
        </nav>

        {/* Sidebar footer */}
        <div className="p-2 border-t border-border">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className={cn(
              "sidebar-item w-full",
              !sidebarOpen && "justify-center px-2"
            )}
          >
            {sidebarOpen ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
            {sidebarOpen && <span className="text-xs text-muted-foreground">Einklappen</span>}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
        {/* Topbar / Navbar */}
        <header className="flex items-center justify-between h-14 px-4 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shrink-0">
          <div className="flex items-center gap-2">
            {/* Breadcrumb placeholder */}
            <span className="text-sm text-muted-foreground font-medium">
              {t("app.name")} Studio
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Language Selector */}
            <Select
              value={i18n.language?.startsWith("en") ? "en" : "de"}
              onValueChange={(v) => i18n.changeLanguage(v)}
            >
              <SelectTrigger className="w-28 h-8 text-xs border-border bg-background">
                <Globe className="w-3 h-3 mr-1" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="de">{t("lang.de")}</SelectItem>
                <SelectItem value="en">{t("lang.en")}</SelectItem>
              </SelectContent>
            </Select>

            <Separator orientation="vertical" className="h-6" />

            {/* Theme Toggle */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={toggleTheme}
              title={t("theme.toggle")}
            >
              {theme === "dark"
                ? <Sun className="h-4 w-4" />
                : <Moon className="h-4 w-4" />
              }
            </Button>

            {/* MLX badge */}
            <div className="hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20">
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              <span className="text-[10px] font-medium text-primary">MLX-LM</span>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
