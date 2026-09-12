'use client';
export default function ErrorPage({reset}:{reset:()=>void}){return <main id="main" className="account-page"><a href="/" className="brand">Verra</a><h1>We couldn’t load that.</h1><p>Your saved visits remain in your account. Try loading them again.</p><button onClick={reset}>Try again</button></main>;}
