import * as React from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSession } from '@/features/auth/session';
import type { MessageKey } from '@/i18n';
import { agentApi, type AgentConversation, type AgentDetail, type AgentMessage } from './api';

export function agentError(error: unknown): MessageKey {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
  if (status === 401 || status === 403) return 'screen.agent.accessFailed';
  if (status === 404) return 'screen.agent.notFound';
  if (status === 409) return 'screen.agent.busy';
  if (status === 429) return 'screen.agent.rateLimited';
  if (status === 502 || status === 503 || status === 504) return 'screen.agent.unavailable';
  return 'screen.agent.requestFailed';
}
type LiveTurn = { base: AgentMessage[]; question: string; text: string };
const foreground = () => AppState.currentState !== 'background' && AppState.currentState !== 'inactive';

/** Route-owned state only. No personal messages or selection are stored on disk. */
export function useAgent() {
  const { handleAuthFailure } = useSession();
  const auth = React.useRef(handleAuthFailure);
  React.useEffect(() => { auth.current = handleAuthFailure; }, [handleAuthFailure]);
  const [id, setId] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<AgentDetail | null>(null);
  const [draft, setDraft] = React.useState('');
  const [live, setLive] = React.useState<LiveTurn | null>(null);
  const [working, setWorking] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [recovering, setRecovering] = React.useState(false);
  const [error, setError] = React.useState<MessageKey | null>(null);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [history, setHistory] = React.useState<AgentConversation[]>([]);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [historyBusy, setHistoryBusy] = React.useState(false);
  const [historyError, setHistoryError] = React.useState<MessageKey | null>(null);
  const [deleted, setDeleted] = React.useState<AgentConversation | null>(null);
  const [active, setActive] = React.useState(foreground);
  const focused = React.useRef(false);
  const epoch = React.useRef(0);
  const readVersion = React.useRef(0);
  const pendingQuestion = React.useRef<{ text: string; userCount: number } | null>(null);
  const selected = React.useRef<string | null>(null);
  const sending = React.useRef(false);
  const mutating = React.useRef(false);
  const appActive = React.useRef(foreground());
  const requests = React.useRef(new Set<AbortController>());
  const stream = React.useRef<AbortController | null>(null);
  const current = React.useCallback((version: number) => focused.current && epoch.current === version, []);
  const request = () => { const controller = new AbortController(); requests.current.add(controller); return controller; };
  const abortAll = React.useCallback(() => { requests.current.forEach(controller => controller.abort()); requests.current.clear(); }, []);
  const fail = React.useCallback(async (failure: unknown, version: number, history = false) => {
    if (!current(version)) return;
    const key = agentError(failure);
    if (key === 'screen.agent.accessFailed') await auth.current(failure);
    if (current(version)) (history ? setHistoryError : setError)(key);
  }, [current]);
  const reset = React.useCallback((keepHistory = false) => {
    epoch.current++; abortAll(); selected.current = null; sending.current = false; mutating.current = false;
    pendingQuestion.current = null;
    setId(null); setSaved(null); setDraft(''); setLive(null); setWorking(false); setLoading(false);
    setRecovering(false); setError(null); setHistoryOpen(false);
    setHistoryLoading(false); setHistoryBusy(false); setHistoryError(null);
    if (!keepHistory) { setHistory([]); setDeleted(null); }
  }, [abortAll]);
  useFocusEffect(React.useCallback(() => {
    focused.current = true; reset();
    return () => { focused.current = false; epoch.current++; abortAll(); };
  }, [reset, abortAll]));

  const readSaved = React.useCallback(async (target: string, initial = false) => {
    const version = epoch.current;
    const read = ++readVersion.current;
    const controller = new AbortController(); requests.current.add(controller);
    if (initial) setLoading(true);
    try {
      const result = await agentApi.get(target, controller.signal);
      if (!current(version) || selected.current !== target || read !== readVersion.current) return;
      const question = pendingQuestion.current;
      const users = result.messages.filter(message => message.role === 'user');
      if (question && users.length > question.userCount && users[users.length - 1]?.text === question.text) {
        setDraft(value => value.trim() === question.text ? '' : value); pendingQuestion.current = null;
      }
      setSaved(result); setLive(null); setRecovering(false);
      if (result.running || result.messages[result.messages.length - 1]?.role === 'assistant' || (!question && !result.messages.length)) setError(null);
    } catch (failure) {
      if (!controller.signal.aborted && selected.current === target && read === readVersion.current) await fail(failure, version);
    } finally {
      requests.current.delete(controller);
      if (current(version) && selected.current === target && read === readVersion.current) setLoading(false);
    }
  }, [current, fail]);

  React.useEffect(() => {
    const listener = AppState.addEventListener('change', status => {
      appActive.current = status === 'active'; setActive(appActive.current);
      if (!appActive.current) stream.current?.abort();
      else if (focused.current && selected.current && !sending.current) void readSaved(selected.current);
    });
    return () => listener.remove();
  }, [readSaved]);
  React.useEffect(() => {
    if (!active || working || !saved?.running || !id) return;
    const timer = setTimeout(() => { void readSaved(id); }, 1500);
    return () => clearTimeout(timer);
  }, [active, id, readSaved, saved, working]);

  async function send() {
    const question = draft.trim();
    if (!question || question.length > 4000 || sending.current || mutating.current || loading || recovering
      || saved?.running || saved?.exhausted || saved?.pending.length) return;
    const version = epoch.current;
    sending.current = true; setWorking(true); setRecovering(true); setError(null);
    pendingQuestion.current = { text: question, userCount: (saved?.messages ?? []).filter(message => message.role === 'user').length };
    setLive({ base: saved?.messages ?? [], question, text: '' });
    const controller = request(); stream.current = controller;
    let target = selected.current;
    try {
      if (!target) {
        const created = await agentApi.create(controller.signal);
        if (!current(version) || controller.signal.aborted) return;
        target = created.id; selected.current = target; setId(target);
      }
      await agentApi.stream(target, question, event => {
        if (!current(version) || controller.signal.aborted) return;
        if (event.type === 'token') setLive(previous => previous ? { ...previous, text: previous.text + (event.text ?? '') } : previous);
        if (['done', 'interrupt'].includes(event.type)) setDraft(value => value.trim() === question ? '' : value);
        if (event.type === 'error') setError('screen.agent.interrupted');
        if (event.type === 'limit') setError('screen.agent.exhausted');
      }, controller.signal);
    } catch (failure) {
      if (!controller.signal.aborted) await fail(failure, version);
    } finally {
      requests.current.delete(controller);
      if (current(version)) {
        sending.current = false; stream.current = null; setWorking(false);
        if (target && appActive.current) await readSaved(target, true);
        else if (!target) { setLive(null); setRecovering(false); }
      }
    }
  }
  async function loadHistory() {
    const version = epoch.current;
    const controller = request(); setHistoryLoading(true); setHistoryError(null);
    try {
      const result = await agentApi.list(controller.signal);
      if (current(version)) setHistory(result);
    } catch (failure) { if (!controller.signal.aborted) await fail(failure, version, true); }
    finally { requests.current.delete(controller); if (current(version)) setHistoryLoading(false); }
  }
  function openHistory() {
    if (sending.current || mutating.current) return;
    setHistoryOpen(true); void loadHistory();
  }
  function openConversation(entry: AgentConversation) {
    if (sending.current || mutating.current) return;
    epoch.current++; abortAll(); selected.current = entry.id; pendingQuestion.current = null;
    setId(entry.id); setSaved(null); setLive(null); setDraft(''); setError(null);
    setRecovering(false); setHistoryOpen(false); setHistoryLoading(false);
    void readSaved(entry.id, true);
  }
  async function changeHistory(entry: AgentConversation, restore = false) {
    if (sending.current || mutating.current) return;
    const version = epoch.current; const controller = request();
    mutating.current = true; setHistoryBusy(true); setHistoryError(null);
    try {
      if (restore) await agentApi.restore(entry.id, controller.signal);
      else await agentApi.remove(entry.id, controller.signal);
      if (!current(version)) return;
      if (restore) { setDeleted(null); await loadHistory(); }
      else {
        setDeleted(entry); setHistory(previous => previous.filter(item => item.id !== entry.id));
        if (selected.current === entry.id) {
          selected.current = null; setId(null); setSaved(null); setLive(null); setDraft(''); setError(null); setRecovering(false); setLoading(false);
        }
      }
    } catch (failure) { if (!controller.signal.aborted) await fail(failure, version, true); }
    finally {
      requests.current.delete(controller);
      if (current(version)) { mutating.current = false; setHistoryBusy(false); }
    }
  }
  const messages: AgentMessage[] = live ? [...live.base, { role: 'user', text: live.question }, { role: 'assistant', text: live.text }] : saved?.messages ?? [];
  return {
    id, messages, draft, setDraft, working, loading, recovering, error,
    blocked: working || historyBusy || loading || recovering || !!saved?.running || !!saved?.exhausted || !!saved?.pending.length,
    running: !!saved?.running, exhausted: !!saved?.exhausted, pending: !!saved?.pending.length,
    send, refresh: () => { if (selected.current) void readSaved(selected.current, true); },
    stop: () => stream.current?.abort(), newConversation: () => { if (!sending.current && !mutating.current) reset(true); },
    historyOpen, closeHistory: () => setHistoryOpen(false), openHistory, history, historyLoading, historyBusy,
    historyError, loadHistory, openConversation, changeHistory, deleted,
  };
}
