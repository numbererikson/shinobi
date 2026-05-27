import { Link } from 'react-router-dom';

export function NotFound() {
  return (
    <div className="text-center py-16">
      <div className="text-6xl mb-4">🥷</div>
      <h1 className="text-2xl text-text mb-2">Not found</h1>
      <p className="text-text-muted mb-4">The page you're looking for doesn't exist.</p>
      <Link to="/" className="text-accent hover:underline">← Back to home</Link>
    </div>
  );
}
