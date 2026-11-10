import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  hidden: boolean;
  onClose: () => void;
}

/** If one tab fails to render, only that tab shows an error; the rest of the app keeps working. */
export class TabErrorBoundary extends Component<Props, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="collection-tab" hidden={this.props.hidden}>
        <div className="not-run">
          <p className="error">This tab couldn't be shown: {this.state.error.message}</p>
          <button className="btn" onClick={this.props.onClose}>
            Close tab
          </button>
        </div>
      </div>
    );
  }
}
