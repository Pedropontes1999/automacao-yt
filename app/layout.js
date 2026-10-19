import './globals.css';

export const metadata = {
  title: 'YT Automacao',
  description: 'Baixar videos em massa e agendar postagem no YouTube',
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-br">
      <body>{children}</body>
    </html>
  );
}
