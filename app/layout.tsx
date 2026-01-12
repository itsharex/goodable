import './globals.css'
import 'highlight.js/styles/github-dark.css'
import GlobalSettingsProvider from '@/contexts/GlobalSettingsContext'
import { AuthProvider } from '@/contexts/AuthContext'
import Header from '@/components/layout/Header'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Goodable',
  description: 'Goodable Application',
  icons: {
    icon: '/Goodable_Icon.png',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning style={{ backgroundColor: '#f9fafb' }}>
      <head />
      <body className="bg-gray-50 text-gray-900 min-h-screen" style={{ backgroundColor: '#f9fafb' }} suppressHydrationWarning>
        <AuthProvider>
          <GlobalSettingsProvider>
            <Header />
            <main>{children}</main>
          </GlobalSettingsProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
