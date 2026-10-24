import * as React from 'react';
import { FlatList, View } from 'react-native';
import { useRouter } from 'expo-router';
import ArrowLeft from 'lucide-react-native/icons/arrow-left';
import History from 'lucide-react-native/icons/rotate-ccw-clock';
import { Button } from '@/components/ui/Button';
import { ChatBubble } from '@/components/ui/ChatBubble';
import { IconButton } from '@/components/ui/IconButton';
import { InlineNotice } from '@/components/ui/InlineNotice';
import { InputSheet } from '@/components/ui/InputSheet';
import { MarkdownReader } from '@/components/ui/MarkdownReader';
import { Screen } from '@/components/ui/Screen';
import { Text } from '@/components/ui/Text';
import { useTheme } from '@/design-system/theme';
import { useSession } from '@/features/auth/session';
import { useI18n, type MessageKey } from '@/i18n';
import { AgentHistory } from './AgentHistory';
import { useAgent } from './useAgent';
import type { AgentMessage } from './api';
import { updateChatScroll } from '../../../../shared/utils/chatScroll';

const SUGGESTIONS: readonly MessageKey[] = ['screen.agent.suggest.schedule', 'screen.agent.suggest.todo', 'screen.agent.suggest.food'];

export function AgentScreen(): React.ReactElement {
  const { isSignedIn, identifier } = useSession();
  const { t } = useI18n();
  if (!isSignedIn) return <Screen titleKey="screen.agent.title" testID="agent-auth-gate"><Text role="body">{t('screen.agent.signIn')}</Text></Screen>;
  return <AgentWorkspace key={identifier ?? 'restored-session'} />;
}

function AgentWorkspace(): React.ReactElement {
  const agent = useAgent();
  const { t } = useI18n();
  const theme = useTheme();
  const router = useRouter();
  const list = React.useRef<FlatList<AgentMessage>>(null);
  const scrollState = React.useRef({ top: 0, following: true });
  React.useEffect(() => { scrollState.current = { top: 0, following: true }; }, [agent.id]);
  const header = <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: theme.touchTarget, paddingHorizontal: theme.space('space_2') }}>
    <IconButton Icon={ArrowLeft} accessibilityLabel={t('action.back')} onPress={() => router.canGoBack() ? router.back() : router.replace('/')} />
    <View style={{ flex: 1, paddingHorizontal: theme.space('space_2') }}><Text role="headline" emphasis="strong">{t('screen.agent.title')}</Text></View>
    <IconButton testID="agent-history-open" Icon={History} accessibilityLabel={t('screen.agent.history')} disabled={agent.working || agent.historyBusy} onPress={agent.openHistory} />
  </View>;
  const footer = <View>
    {agent.working ? <Button label={t('screen.agent.checkLater')} variant="ghost" size="small" onPress={agent.stop} /> : null}
    <InputSheet testID="agent-composer" accessibilityLabel={t('screen.agent.input')} value={agent.draft} onChangeText={agent.setDraft}
      sendLabel={t('screen.agent.send')} maxLength={4000} disabled={agent.blocked} sendDisabled={!agent.draft.trim()}
      sending={agent.working} onSend={() => { scrollState.current.following = true; void agent.send(); }} />
  </View>;
  return <Screen testID="screen-agent" header={header} footer={footer} bottomMode="own">
    <View style={{ flex: 1, minHeight: 0 }}>
      {agent.error ? <InlineNotice testID="agent-error" tone="warning" message={t(agent.error)}
        actionLabel={agent.id && !agent.working ? t('action.retry') : undefined} onAction={agent.refresh} /> : null}
      {agent.exhausted || agent.pending ? <InlineNotice message={t(agent.exhausted ? 'screen.agent.exhausted' : 'screen.agent.pending')}
        actionLabel={t('screen.agent.new')} onAction={agent.newConversation} /> : null}
      {agent.running && !agent.working ? <Text role="caption" colorToken="text-secondary">{t('screen.agent.stillWorking')}</Text> : null}
      <FlatList ref={list} testID="agent-messages" data={agent.messages} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator
        contentInsetAdjustmentBehavior="never" style={{ flex: 1, minHeight: 0 }}
        contentContainerStyle={{ paddingVertical: theme.space('space_3'), flexGrow: 1 }}
        keyExtractor={(_item, index) => `${agent.id ?? 'draft'}:${index}`}
        onContentSizeChange={() => { if (scrollState.current.following) list.current?.scrollToEnd({ animated: false }); }}
        onScroll={event => {
          const { contentSize, contentOffset, layoutMeasurement } = event.nativeEvent;
          scrollState.current = updateChatScroll(scrollState.current, {
            top: contentOffset.y, height: contentSize.height, viewport: layoutMeasurement.height,
          }, theme.space('space_8'));
        }} scrollEventThrottle={16}
        ListEmptyComponent={agent.loading ? <Text role="body" colorToken="text-secondary">{t('screen.agent.loading')}</Text> : <View testID="agent-empty"
          style={{ padding: theme.space('space_6'), gap: theme.space('space_3'), flex: 1, justifyContent: 'center' }}>
          <Text role="title" emphasis="strong">{t('screen.agent.welcome')}</Text>
          {SUGGESTIONS.map(key => <Button key={key} label={t(key)} variant="secondary" onPress={() => agent.setDraft(t(key))} />)}
        </View>}
        renderItem={({ item, index }) => item.role === 'user' ? <View accessible accessibilityLabel={`${t('screen.agent.you')}: ${item.text}`}>
          <ChatBubble mine content={item.text} testID={`agent-message-${index}`} />
        </View> : <View testID={`agent-message-${index}`} style={{ paddingHorizontal: theme.space('space_4'), paddingVertical: theme.space('space_3'), gap: theme.space('space_2') }}>
          <Text role="label" emphasis="strong" colorToken="text-secondary">{t('screen.agent.title')}</Text>
          {item.text ? <MarkdownReader content={item.text} /> : <Text role="body" colorToken="text-secondary">{t('screen.agent.thinking')}</Text>}
        </View>} />
    </View>
    <AgentHistory agent={agent} />
  </Screen>;
}
