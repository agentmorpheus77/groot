import { Routes, Route, Navigate } from "react-router-dom"
import { Suspense } from "react"
import Layout from "./components/Layout"
import Dashboard from "./pages/Dashboard"
import Datasets from "./pages/Datasets"
import Training from "./pages/Training"
import Models from "./pages/Models"
import Chat from "./pages/Chat"

function App() {
  return (
    <Suspense fallback={
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4">
          <div className="text-4xl animate-bounce">🌱</div>
          <p className="text-muted-foreground text-sm">Groot startet...</p>
        </div>
      </div>
    }>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="datasets" element={<Datasets />} />
          <Route path="training" element={<Training />} />
          <Route path="models" element={<Models />} />
          <Route path="chat" element={<Chat />} />
          <Route path="chat/:modelId" element={<Chat />} />
        </Route>
      </Routes>
    </Suspense>
  )
}

export default App
