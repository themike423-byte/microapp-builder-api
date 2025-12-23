export const metadata = {
  title: 'Microapp Builder API',
  description: 'API for generating CallVu microapps',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
