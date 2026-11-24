/* global module */
/* Shared by the service worker and offline verification. No live backend is used. */
function snapshotResponse(bundle, inputUrl) {
  const url = new URL(inputUrl, 'https://preview.invalid');
  const pathname = url.pathname.slice(url.pathname.indexOf('/api/'));
  if (pathname === '/api/audit-logs/project-history' || pathname === '/api/audit-logs/change-period') {
    const all = bundle.auditLogs || [];
    const ids = url.searchParams.getAll('projectId');
    const keyword = (url.searchParams.get('keyword') || '').toLowerCase();
    const kind = url.searchParams.get('recordKind');
    const logs = all.filter(log => (!ids.length || ids.includes(log.projectId))
      && (!kind || (kind === 'activity' ? log.module === 'project_activity' : log.module !== 'project_activity'))
      && (!keyword || JSON.stringify(log).toLowerCase().includes(keyword))
      && (!url.searchParams.get('startDate') || (log.createdAt || '').slice(0,10) >= url.searchParams.get('startDate'))
      && (!url.searchParams.get('endDate') || (log.createdAt || '').slice(0,10) <= url.searchParams.get('endDate')));
    const page = Math.max(0, Number(url.searchParams.get('page')) || 0);
    const pageSize = Math.min(1000, Math.max(1, Number(url.searchParams.get('pageSize')) || 100));
    return { status: 200, body: { success: true, data: { logs: logs.slice(page*pageSize,(page+1)*pageSize), page, pageSize, total: logs.length }, message: '只读快照' } };
  }
  if (pathname === '/api/audit-logs') {
    const data = (bundle.auditLogs || []).filter(log => [...url.searchParams].every(([key,value]) => !value || (key === 'keyword' ? JSON.stringify(log).includes(value) : key === 'startDate' || key === 'endDate' ? true : String(log[key] || '') === value)));
    return { status: 200, body: { success: true, data, message: '只读快照' } };
  }
  const queryKey = pathname + '?' + [...url.searchParams].sort(([a,av],[b,bv]) => a.localeCompare(b) || av.localeCompare(bv)).map(([k,v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  return bundle.responses[queryKey] || bundle.responses[pathname] || { status: 404, body: { success:false, message:'此接口未包含在只读快照中；完整原始记录可在数据库页查看。' } };
}
if (typeof module !== 'undefined') module.exports = { snapshotResponse };
