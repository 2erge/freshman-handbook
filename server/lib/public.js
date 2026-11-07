'use strict';
/**
 * 对外公开视图（在线服务与静态导出共用，避免两处逻辑漂移）
 *
 * 只暴露前台需要展示的字段：分区、条目摘要；正文由 /api/entry 单独取。
 * 敏感字段（users / lock.password / 条目 blocks）一律不进入这里。
 */

function publicSchool(school) {
  const sections = (school.sections || [])
    .filter((s) => s.visible !== false)
    .map((s) => ({
      id: s.id,
      title: s.title,
      subtitle: s.subtitle || '',
      layout: s.layout,
      countText: s.countText || '',
      entries: (s.entries || []).map((e, i) => ({
        id: e.id,
        title: e.title,
        subtitle: e.subtitle || '',
        icon: e.icon || '',
        type: e.type || 'article',
        url: e.url || '',
        order: i,
        locked: !!(e.lock && e.lock.enabled),
      })),
    }));
  const { users, ...rest } = school;
  return { ...rest, sections };
}

module.exports = { publicSchool };
