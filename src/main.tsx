import { createRoot } from 'react-dom/client'
import App from './App'
import { TOKENS_CLARO, TOKENS_OSCURO, cssDeTokens } from './ui/tema'

const estilo = document.createElement('style')
estilo.textContent = cssDeTokens(TOKENS_CLARO, TOKENS_OSCURO)
document.head.append(estilo)

createRoot(document.getElementById('root')!).render(<App />)
