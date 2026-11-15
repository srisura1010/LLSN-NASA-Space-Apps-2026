"use client";

import { Component, type ReactNode } from "react";

/** Shows `fallback` (or nothing) in place of a part that threw while rendering, and reports it once. */
export class ErrorBoundary extends Component<{ fallback?: ReactNode; onError?: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onError?.();
  }
  render() {
    return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
  }
}
