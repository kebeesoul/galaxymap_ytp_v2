import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Galaxy Map YTP',
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
          href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@700&family=Black+Han+Sans&family=Nanum+Gothic:wght@700&family=Gothic+A1:wght@700&family=Noto+Serif+KR:wght@700&family=Gowun+Dodum&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
