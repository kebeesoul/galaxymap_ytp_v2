import type { Metadata } from 'next'
import AppNav from '@/components/navigation/AppNav'
import { GOOGLE_FONTS_STYLESHEET } from '@/lib/fonts'
import './globals.css'

export const metadata: Metadata = {
  title: 'galaxymap_ytp_v2',
  description: 'Music Shortform Generator',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Korean fonts for subtitle / comment style preview */}
        <link
          href={GOOGLE_FONTS_STYLESHEET}
          rel="stylesheet"
        />
      </head>
      <body>
        <AppNav />
        {children}
      </body>
    </html>
  )
}
