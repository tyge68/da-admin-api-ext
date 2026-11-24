import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Badge, Button, Cell, Column, InlineAlert, Heading, Content, ProgressCircle,
  Row, TableBody, TableHeader, TableView, Text,
} from '@react-spectrum/s2';
import { style } from '@react-spectrum/s2/style' with { type: 'macro' };
import { AdminApiError, type SiteRef } from '../api/adminClient';
import { expiryState, type ExpiryState } from '../lib/normalize';

const col = style({ display: 'flex', flexDirection: 'column', gap: 8 });
const bar = style({ display: 'flex', flexDirection: 'row', gap: 8, alignItems: 'center' });

export interface TabCtx<R> { rows: R[] | null; refresh: () => Promise<void> }
export interface ColumnDef<R> { id: string; name: string; render: (r: R, ctx: TabCtx<R>) => ReactNode; isRowHeader?: boolean }

export function ExpiryBadge({ state, label }: { state: ExpiryState; label: string }) {
  if (state === 'none') return <Text>No expiry</Text>;
  const variant = state === 'expired' ? 'negative' : state === 'soon' ? 'notice' : 'neutral';
  const prefix = state === 'expired' ? 'Expired ' : state === 'soon' ? 'Expiring ' : '';
  return <span style={{ whiteSpace: 'nowrap' }}><Badge variant={variant}>{prefix}{label}</Badge></span>;
}

/** Generic read-only tab: loads on mount / site change, Refresh button, error alert, table. */
export function DataTab<R extends { id: string }>(props: {
  label: string;
  site: SiteRef;
  load: (s: SiteRef) => Promise<R[]>;
  columns: ColumnDef<R>[];
  emptyText: string;
  /** Extra controls next to Refresh (e.g. a Create button). */
  toolbar?: (ctx: TabCtx<R>) => ReactNode;
}) {
  const { org, site } = props.site;
  const [rows, setRows] = useState<R[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!org || !site) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await props.load({ org, site }));
    } catch (e) {
      setRows(null);
      setError(e instanceof AdminApiError || e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [org, site, props.load]);

  useEffect(() => { void refresh(); }, [refresh]);
  const ctx: TabCtx<R> = { rows, refresh };

  return (
    <div className={col}>
      <div className={bar}>
        <Button variant="secondary" onPress={refresh} isDisabled={loading || !org || !site}>Refresh</Button>
        {org && site && props.toolbar?.(ctx)}
        {loading && <ProgressCircle isIndeterminate aria-label={`Loading ${props.label}`} size="S" />}
      </div>
      {!org || !site ? (
        <Text>Open a site in da.live (or enter org and site) to load {props.label}.</Text>
      ) : error ? (
        <InlineAlert variant="negative">
          <Heading>Could not load {props.label}</Heading>
          <Content>{error}</Content>
        </InlineAlert>
      ) : rows && rows.length === 0 ? (
        <Text>{props.emptyText}</Text>
      ) : rows ? (
        <TableView aria-label={props.label} overflowMode="wrap">
          <TableHeader columns={props.columns}>
            {(c) => <Column id={c.id} isRowHeader={c.isRowHeader}>{c.name}</Column>}
          </TableHeader>
          <TableBody items={rows}>
            {(r) => (
              <Row id={r.id} columns={props.columns}>
                {(c) => <Cell>{c.render(r, ctx)}</Cell>}
              </Row>
            )}
          </TableBody>
        </TableView>
      ) : null}
    </div>
  );
}
