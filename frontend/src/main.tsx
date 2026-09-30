import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { guardian } from './services/telemetry'
import './styles.css'

void guardian.initialize()
ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>)
if (import.meta.hot) import.meta.hot.dispose(() => guardian.dispose())
