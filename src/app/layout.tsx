import type { Metadata, Viewport } from 'next'
import '@/styles/globals.css'

export const metadata: Metadata = {
  title:       'Hermes — Personal Economy AI',
  description: 'Live agent dashboard, signals, smart-money intelligence',
}

export const viewport: Viewport = {
  width:        'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor:   '#09090b',
  viewportFit:  'cover',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="h-[100dvh] overflow-hidden bg-zinc-950 text-zinc-100 antialiased">
        {children}
      </body>
    </html>
  )
}
