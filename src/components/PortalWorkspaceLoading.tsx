"use client";

type PortalWorkspaceLoadingProps = {
  message: string;
  error?: Error | null;
  retry?: () => void;
};

export function PortalWorkspaceLoading({ message, error, retry }: PortalWorkspaceLoadingProps) {
  if (error) {
    return <div role="alert">
      <p>This workspace could not be opened.</p>
      {retry ? <button type="button" onClick={retry}>Retry</button> : <p>Refresh the page to try again.</p>}
    </div>;
  }
  return <p role="status">{message}</p>;
}
