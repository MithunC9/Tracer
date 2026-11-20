'use client';
import { useState } from 'react';
import {
  AccessLogTable,
  Button,
  ConfirmDeleteDialog,
  Dialog,
  ErrorState,
  LedgerTable,
  Notice,
  ToastProvider,
  useToast,
  Toggle,
  type LedgerRow,
} from '@tracer/ui';

export function DialogDemo() {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        Delete all audit data
      </Button>
      <ConfirmDeleteDialog
        open={open}
        onClose={() => setOpen(false)}
        subject="all audit data"
        pending={pending}
        consequences={
          <ul>
            <li>
              <span>Raw events</span>
              <span className="tr-num">18,442</span>
            </li>
            <li>
              <span>Reports</span>
              <span className="tr-num">1</span>
            </li>
            <li>
              <span>Paired devices</span>
              <span className="tr-num">1</span>
            </li>
          </ul>
        }
        onConfirm={() => {
          setPending(true);
          setTimeout(() => {
            setPending(false);
            setOpen(false);
          }, 1200);
        }}
      />
    </>
  );
}

function ToastButtons() {
  const t = useToast();
  return (
    <div className="ds-row">
      <Button variant="secondary" size="sm" onClick={() => t.push({ tone: 'success', body: 'Exclusions saved. They apply from the next upload.' })}>
        Success toast
      </Button>
      <Button variant="secondary" size="sm" onClick={() => t.push({ tone: 'info', title: 'Capture paused', body: 'Nothing is recorded until you resume.' })}>
        Info toast
      </Button>
      <Button variant="secondary" size="sm" onClick={() => t.push({ tone: 'error', title: 'Upload failed', body: 'Events are kept on your Mac and retried in 5 minutes.', duration: 0 })}>
        Sticky error toast
      </Button>
    </div>
  );
}

export function ToastDemo() {
  return (
    <ToastProvider>
      <ToastButtons />
    </ToastProvider>
  );
}

export function NoticeDemo() {
  const [shown, setShown] = useState(true);
  return shown ? (
    <Notice tone="warning" title="Two days without events" onDismiss={() => setShown(false)}>
      Your Mac has not uploaded since Tuesday. Check that Tracer is running.
    </Notice>
  ) : (
    <Button variant="quiet" size="sm" onClick={() => setShown(true)}>
      Show the notice again
    </Button>
  );
}

export function ErrorDemo() {
  const [retrying, setRetrying] = useState(false);
  return (
    <ErrorState
      title="The report did not load"
      code="internal"
      requestId="req_8Kd2pQ"
      retrying={retrying}
      onRetry={() => {
        setRetrying(true);
        setTimeout(() => setRetrying(false), 1500);
      }}
    >
      Your data is safe. The server could not assemble the report just now.
    </ErrorState>
  );
}

export function LedgerErrorDemo({ rows }: { rows: LedgerRow[] }) {
  return (
    <LedgerTable
      rows={rows}
      caption="Ranked workflows (error state)"
      error={{ title: 'Could not rank workflows', body: 'The scoring stage failed after 3 attempts. It will retry on its own.', onRetry: () => {} }}
    />
  );
}

export function AccessErrorDemo() {
  return <AccessLogTable entries={[]} error={{ title: 'Access log unavailable', body: 'Try again in a minute.', onRetry: () => {}, requestId: 'req_3Fz0aL' }} />;
}

export function ToggleDemo() {
  const [paused, setPaused] = useState(false);
  return <Toggle label="Pause capture" hint={paused ? 'Paused. Nothing is recorded.' : 'Recording app focus and window titles.'} checked={paused} onChange={setPaused} onLabel="Paused" offLabel="On" />;
}

export function InlineConfirmDemo() {
  return <ConfirmDeleteDialog inline open onClose={() => {}} onConfirm={() => {}} subject="all audit data" />;
}

export function InlineDialogDemo() {
  return (
    <Dialog
      inline
      open
      onClose={() => {}}
      title="Pause capture for how long?"
      description={<p>Tracer stops recording immediately. Paused time is excluded from every number in the report and listed in the limitations.</p>}
      actions={
        <>
          <Button variant="secondary">Cancel</Button>
          <Button>Pause for 1 hour</Button>
        </>
      }
    >
      <p className="ds-small">If you pause for more than a day, the audit window does not extend. Start a new audit if you need seven full days.</p>
    </Dialog>
  );
}
