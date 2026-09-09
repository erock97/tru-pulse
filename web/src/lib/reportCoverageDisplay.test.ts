import { it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ReportCoverageNotice } from '../components/CoachBrief';
import type { BriefView } from './coachBriefData';
const view = {agents:[]} as unknown as BriefView;
it('renders a prominent legacy unknown warning',()=>{const html=renderToStaticMarkup(createElement(ReportCoverageNotice,{view}));expect(html).toContain('Report coverage unknown');expect(html).toContain('Missing information does not mean zero activity or no response');expect(html).not.toContain('coverage complete')});
it('names unresolved contacts and escapes supplied markup; print expands the list',()=>{const html=renderToStaticMarkup(createElement(ReportCoverageNotice,{print:true,view:{...view,coverage:{schemaVersion:'1.0',scope:'report_window',rosterComplete:false,contacts:[{leadId:'123',leadName:'<script>Example</script>',agentName:null,status:'unresolved',reason:'history_incomplete'}]}}}));expect(html).toContain('1 known unresolved contact');expect(html).toContain('additional contacts may be missing');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');expect(html).toContain('open=""')});
