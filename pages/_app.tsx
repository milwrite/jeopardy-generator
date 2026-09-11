import '../styles/globals.css';
import type { AppProps } from 'next/app';
import { Barlow_Condensed, Barlow } from 'next/font/google';
import ErrorBoundary from '../src/ErrorBoundary';
import { useEffect } from 'react';

const displayFont = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-display',
});

const uiFont = Barlow({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-ui',
});

export default function MyApp({ Component, pageProps }: AppProps) {
  useEffect(() => {
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('Unhandled promise rejection:', event.reason);
      event.preventDefault();
    };

    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    
    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  return (
    <div className={`${displayFont.variable} ${uiFont.variable}`}>
      <ErrorBoundary>
        <Component {...pageProps} />
      </ErrorBoundary>
    </div>
  );
}
