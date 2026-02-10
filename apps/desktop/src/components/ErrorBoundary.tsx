/**
 * ErrorBoundary -- catches render errors in child components.
 *
 * Displays a recovery UI instead of crashing the entire app.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@openai/apps-sdk-ui/components/Button';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Optional fallback UI. If not provided, a default recovery UI is shown. */
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Caught error:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="flex flex-col items-center justify-center p-8 gap-4">
          <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-6 py-4 max-w-md text-center">
            <h3 className="text-sm font-semibold text-red-400 mb-2">
              Something went wrong
            </h3>
            <p className="text-xs text-tertiary mb-4">
              {this.state.error?.message ?? 'An unexpected error occurred.'}
            </p>
            <Button
              size="sm"
              variant="soft"
              color="secondary"
              onClick={this.handleReset}
            >
              Try again
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
