'use client'
import { selectedRefMods } from './store'
import { activeSetMembers, refModTokens, type RefModSet, type RefModTarget, type ReferenceLabel } from './types'
import { studioReferenceLabels } from './reference-map'

export const REF_MOD_ASSISTANT_HELP = '\n\n=== REFMODS В СТУДИИ ===\nRefMods — повторно используемые визуальные/экспериментальные аудио-референсы, это кодирование латентов, без обучения весов. Готовый комплект выбирают кнопкой RefMods в модальном окне: вкладка «Библиотека» → «Добавить», настройки — «Выбранные». Создание, импорт и редактируемые проекты находятся в разделе «RefMods»; Full Reference — по умолчанию, Compressed — отдельный выбор. Набор отдельный для каждой рабочей вкладки. Компоненты активного набора отображаются среди референсов генерации. При отсутствии активного набора не придумывай его метки. Аудио экспериментально, перенос личности голоса не гарантирован. Ты помогаешь с промптом и настройками, а действия в библиотеке пользователь выполняет в интерфейсе.\n'

/** Metadata only: latent files and library covers are never sent as source media. */
export function describeRefModContext(set: RefModSet, labels: ReferenceLabel[]): string {
  const tokens = refModTokens(set)
  if (!tokens) return ''
  const lines = [
    '\n=== АКТИВНЫЕ REFMODS И ОБЩАЯ КАРТА РЕФЕРЕНСОВ ===',
    'Это текущий набор именно этой вкладки. Только перечисленные метки существуют; прежние карты из истории чата устарели.',
    ...labels.map(l => `${l.trigger} = ${JSON.stringify(l.label)}`),
    'Компоненты RefMods (данные файла, а не результат просмотра или прослушивания):',
  ]
  for (const item of set.items) {
    for (const member of activeSetMembers(set, item)) {
      const tags = labels.filter(l => Array.from({ length: item.copies }, (_, copy) => `${item.id}:${member.index}:${copy}`).includes(l.id))
      lines.push(JSON.stringify({
        labels: tags.map(l => l.trigger), refMod: item.name, component: member.name,
        kind: member.kind, description: (member.description || '').slice(0, 1200), mode: member.mode,
        strength: item.strength, componentStrength: member.kind === 'audio' ? item.audioStrength : item.visualStrength,
        copies: item.copies, tokens: member.tokens * item.copies,
      }))
    }
  }
  lines.push(
    `Бюджет RefMods: ${tokens}/${set.maxTokens} токенов${tokens > set.maxTokens ? ' — ПРЕВЫШЕН, генерация будет остановлена; предложи уменьшить копии/компоненты или изменить бюджет' : ''}. Автоматического усечения нет. Обычные референсы расходуют дополнительные токены.`,
    `Общее сохранение: ${set.retention ?? 1}. Кривая по кадрам РЕФЕРЕНСА: ${JSON.stringify(set.frameCurve)}. Кривая по ШАГАМ ГЕНЕРАЦИИ: ${JSON.stringify(set.stepCurve)}. Это не расписание событий готового ролика.`,
    'Используй реальные метки нужных компонентов; имя файла не является триггером. Копии имеют отдельные метки и не равны силе. Смешанный комплект содержит независимые компоненты.',
    'Ты не видел и не слышал содержимое RefMods: исходные медиа не приложены. Описание — метаданные пользователя, обложка — только иллюстрация комплекта. Не выдумывай внешность, движение или реплики; при нехватке описания уточни нужную деталь. Full/Compressed обозначают сохранение латента, а не гарантию идентичности.',
    'Аудио RefMods экспериментально: не обещай перенос личности голоса или привязку голоса к персонажу смешанного комплекта. Текст реплик бери из запроса пользователя.',
    'RefMods уже подключены к задаче и кодированию промпта. Не предлагай повторно добавлять их как обычные файлы. Ты можешь написать промпт и объяснить настройки, но не заявляй, что изменил набор, создал сборку или запустил задачу: таких инструментов у чата нет.',
  )
  return lines.join('\n')
}

export function refModAssistantState(mode: string) {
  const target: RefModTarget = mode === 'extend' ? 'extend' : mode === 'controlnet' ? 'controlnet' : 'generate'
  const set = selectedRefMods(target)
  const labels = studioReferenceLabels(target, set)
  const context = describeRefModContext(set, labels)
  return { target, set, labels, context, active: !!context }
}
export type RefModAssistantState = ReturnType<typeof refModAssistantState>
