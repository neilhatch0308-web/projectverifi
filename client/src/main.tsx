import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
//import './index.css'
import App from './App.tsx'
import './styles/we-verifi-brand.css';
import './styles/ledger-app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
