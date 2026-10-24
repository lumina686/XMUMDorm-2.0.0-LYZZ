/**
 * BottomSheet（`O06`）—— **半屏弹层**（2026-10-18 落地于课表课程详情）
 *
 * 组件定义 §2.5：半模态，用于"就地展开内容、不离开上下文"。
 * 与相邻组件的分工：
 *   - `O05 ActionSheet` 是**一组平级动作**（没有内容区）；
 *   - `O06 BottomSheet` 是**内容容器**（课程详情、筛选条件等），有标题与主体；
 *   - `O12 FullScreenNotice` 是全屏接管，不用于常规内容。
 *
 * 三条纪律：
 *   1. **只做容器**：标题、主体、关闭方式；业务字段由调用方传（⛔ 本文件不写业务文案）；
 *   2. **关闭方式三种**：点遮罩、点关闭键、系统返回（`onRequestClose`）；
 *   3. **insets 由调用方给**（宪法 17.1-S2/S7）：本文件不 import safe-area-context。
 *
 * 视觉取令牌：
 *   - 弹层底色 `bg-raised`（令牌注释明确它是"弹层/Sheet"的表面）；
 *   - 遮罩 = 亮色主题用 `text-primary`（深墨）+ 透明度、暗色主题用 `bg-sunken`（最暗）+ 透明度 ——
 *     ⛔ 不写 rgba/hex 字面量。
 */

import * as React from 'react';
import { Modal, ScrollView, useWindowDimensions, View } from 'react-native';
import CloseIcon from 'lucide-react-native/icons/x';

import { useTheme } from '@/design-system/theme';
import { IconButton } from './IconButton';
import { Pressable } from './Pressable';
import { Surface } from './Surface';
import { Text } from './Text';

/** 默认占屏比例（所有者 2026-10-18："下方弹起弹窗半页面"） */
export const BOTTOM_SHEET_DEFAULT_RATIO = 0.5;

export type BottomSheetProps = {
  visible: boolean;
  /** 标题（可选）：说明"这块内容是什么" */
  title?: string;
  onClose: () => void;
  /** 关闭动作的读屏标签（必须给：纯图标不可读） */
  closeLabel: string;
  /** 底部安全区（调用方从 `useScreenInsets()` 取；⛔ 本组件不自读） */
  bottomInset?: number;
  /** 占屏比例（0,1]，默认 0.5） */
  heightRatio?: number;
  children: React.ReactNode;
  testID?: string;
};

export function BottomSheet({
  visible,
  title,
  onClose,
  closeLabel,
  bottomInset = 0,
  heightRatio = BOTTOM_SHEET_DEFAULT_RATIO,
  children,
  testID,
}: BottomSheetProps): React.ReactElement | null {
  const theme = useTheme();
  const window = useWindowDimensions();
  const ratio =
    Number.isFinite(heightRatio) && heightRatio > 0 && heightRatio <= 1
      ? heightRatio
      : BOTTOM_SHEET_DEFAULT_RATIO;
  const sheetHeight = Math.round(window.height * ratio);
  const safeBottom = Number.isFinite(bottomInset) && bottomInset > 0 ? bottomInset : 0;

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View accessibilityViewIsModal style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Pressable
          testID={testID ? `${testID}-backdrop` : undefined}
          accessibilityRole="button"
          accessibilityLabel={closeLabel}
          onPress={onClose}
          style={{
            ...StyleSheetAbsoluteFill,
            // 亮色遮罩用深墨、暗色遮罩用最暗底：都来自令牌（⛔ 不用 rgba/hex）
            backgroundColor: theme.color[theme.scheme === 'dark' ? 'bg-sunken' : 'text-primary'].value,
            opacity: 0.55,
          }}
        />
        <Surface
          testID={testID}
          rounded="radius_large"
          bordered="subtle"
          style={{
            height: sheetHeight,
            paddingBottom: safeBottom,
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
          }}
        >
          <View
            // 视觉抓握条：不接管手势（本版不做拖拽，见批次文档 §5）
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ alignItems: 'center', paddingTop: theme.space('space_2') }}
          >
            <View
              style={{
                width: theme.space('space_8'),
                height: theme.borderWidth('border_width_brutal'),
                borderRadius: theme.radius('radius_full'),
                backgroundColor: theme.color['border-strong'].value,
              }}
            />
          </View>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space('space_2'),
              paddingLeft: theme.space('space_4'),
              paddingRight: theme.space('space_2'),
              paddingVertical: theme.space('space_1'),
            }}
          >
            <View style={{ flex: 1 }}>
              {title === undefined ? null : (
                <Text role="headline" emphasis="strong" colorToken="text-primary" numberOfLines={1}>
                  {title}
                </Text>
              )}
            </View>
            <IconButton
              testID={testID ? `${testID}-close` : undefined}
              Icon={CloseIcon}
              accessibilityLabel={closeLabel}
              onPress={onClose}
            />
          </View>

          <ScrollView
            testID={testID ? `${testID}-body` : undefined}
            contentInsetAdjustmentBehavior="never"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              padding: theme.space('space_4'),
              paddingTop: theme.space('space_2'),
              paddingBottom: theme.space('space_6'),
              gap: theme.space('space_3'),
            }}
          >
            {children}
          </ScrollView>
        </Surface>
      </View>
    </Modal>
  );
}

/** RN 里没有 CSS 的 absolute-fill；用显式四边 0 表达（避免 `StyleSheet.absoluteFill` 的类型歧义） */
const StyleSheetAbsoluteFill = { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0 };
