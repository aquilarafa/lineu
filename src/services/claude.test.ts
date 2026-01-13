import { describe, it, expect } from 'vitest';
import {
  processChunksWithLineBuffering,
  extractJsonFromText,
  parseNdjsonForResult,
} from './claude.js';

describe('Claude output parsing', () => {
  describe('extractJsonFromText', () => {
    it('extracts JSON from markdown code block', () => {
      const text = `Here is the analysis:

\`\`\`json
{
  "category": "bug",
  "summary": "Test error",
  "priority": "high"
}
\`\`\`

That's my analysis.`;

      const result = extractJsonFromText(text);
      expect(result.category).toBe('bug');
      expect(result.summary).toBe('Test error');
    });

    it('extracts JSON without markdown wrapper', () => {
      const text = `{
  "category": "infrastructure",
  "summary": "Server timeout",
  "priority": "medium"
}`;

      const result = extractJsonFromText(text);
      expect(result.category).toBe('infrastructure');
      expect(result.summary).toBe('Server timeout');
    });

    it('handles JSON with escaped characters', () => {
      const text = `\`\`\`json
{
  "category": "bug",
  "summary": "Error with \\"quotes\\" and newlines",
  "code_example": "line1\\nline2"
}
\`\`\``;

      const result = extractJsonFromText(text);
      expect(result.category).toBe('bug');
      expect(result.summary).toBe('Error with "quotes" and newlines');
    });

    it('skips invalid JSON blocks and finds valid one', () => {
      const text = `\`\`\`json
{ invalid json }
\`\`\`

\`\`\`json
{
  "category": "bug",
  "summary": "Valid analysis"
}
\`\`\``;

      const result = extractJsonFromText(text);
      expect(result.category).toBe('bug');
      expect(result.summary).toBe('Valid analysis');
    });

    it('throws error when no valid JSON found', () => {
      const text = 'No JSON here, just plain text';
      expect(() => extractJsonFromText(text)).toThrow('No valid JSON analysis found');
    });

    it('requires both category and summary fields in markdown blocks', () => {
      // When JSON is in markdown block, both fields are required
      const text = `\`\`\`json
{
  "category": "bug"
}
\`\`\``;

      // Markdown block without summary is skipped, falls through to raw JSON search
      // which finds it and returns it (raw JSON path doesn't require both fields)
      const result = extractJsonFromText(text);
      expect(result.category).toBe('bug');
      expect(result.summary).toBeUndefined();
    });

    it('validates markdown blocks but accepts raw JSON without both fields', () => {
      // If only markdown block exists and is invalid, and no raw JSON pattern matches, it throws
      const text = `\`\`\`json
{
  "name": "not an analysis"
}
\`\`\``;

      expect(() => extractJsonFromText(text)).toThrow('No valid JSON analysis found');
    });
  });

  describe('processChunksWithLineBuffering', () => {
    it('handles complete lines in single chunk', () => {
      const chunks = ['{"type":"system","data":"init"}\n{"type":"result","result":"test"}\n'];
      const { lines, lastResult } = processChunksWithLineBuffering(chunks);

      expect(lines).toHaveLength(2);
      expect(lastResult).toEqual({ type: 'result', result: 'test' });
    });

    it('buffers incomplete lines across chunks', () => {
      // Simulate a line split across two chunks
      const fullLine = '{"type":"result","result":"complete data"}';
      const chunk1 = fullLine.substring(0, 20); // '{"type":"result","re'
      const chunk2 = fullLine.substring(20) + '\n'; // 'sult":"complete data"}\n'

      const chunks = [chunk1, chunk2];
      const { lines, lastResult } = processChunksWithLineBuffering(chunks);

      expect(lines).toHaveLength(1);
      expect(lastResult).toEqual({ type: 'result', result: 'complete data' });
    });

    it('handles multiple lines split across multiple chunks', () => {
      const line1 = '{"type":"assistant","content":"analyzing"}';
      const line2 = '{"type":"result","result":"done"}';

      // Split in the middle of each line
      const chunks = [
        line1.substring(0, 15),
        line1.substring(15) + '\n' + line2.substring(0, 10),
        line2.substring(10) + '\n',
      ];

      const { lines, lastResult } = processChunksWithLineBuffering(chunks);

      expect(lines).toHaveLength(2);
      expect(lastResult).toEqual({ type: 'result', result: 'done' });
    });

    it('handles line without trailing newline (remaining buffer)', () => {
      const chunks = ['{"type":"result","result":"final"}'];
      const { lines, lastResult } = processChunksWithLineBuffering(chunks);

      expect(lines).toHaveLength(1);
      expect(lastResult).toEqual({ type: 'result', result: 'final' });
    });

    it('handles empty chunks', () => {
      const chunks = ['', '{"type":"result","result":"test"}\n', ''];
      const { lines, lastResult } = processChunksWithLineBuffering(chunks);

      expect(lines).toHaveLength(1);
      expect(lastResult).toEqual({ type: 'result', result: 'test' });
    });

    it('handles very long lines split into many small chunks', () => {
      const longResult = 'x'.repeat(1000);
      const fullLine = `{"type":"result","result":"${longResult}"}`;

      // Split into 50-character chunks
      const chunks: string[] = [];
      for (let i = 0; i < fullLine.length; i += 50) {
        chunks.push(fullLine.substring(i, i + 50));
      }
      chunks[chunks.length - 1] += '\n';

      const { lines, lastResult } = processChunksWithLineBuffering(chunks);

      expect(lines).toHaveLength(1);
      expect((lastResult as { result: string }).result).toBe(longResult);
    });

    it('ignores non-JSON lines', () => {
      const chunks = ['plain text\n{"type":"result","result":"json"}\nmore text\n'];
      const { lines, lastResult } = processChunksWithLineBuffering(chunks);

      expect(lines).toHaveLength(3);
      expect(lastResult).toEqual({ type: 'result', result: 'json' });
    });

    it('captures last result event when multiple exist', () => {
      const chunks = [
        '{"type":"result","result":"first"}\n',
        '{"type":"result","result":"second"}\n',
      ];
      const { lastResult } = processChunksWithLineBuffering(chunks);

      expect(lastResult).toEqual({ type: 'result', result: 'second' });
    });
  });

  describe('parseNdjsonForResult', () => {
    it('finds result event in NDJSON and extracts JSON from markdown', () => {
      const ndjson = `{"type":"system","data":"init"}
{"type":"assistant","content":"analyzing"}
{"type":"result","result":"\`\`\`json\\n{\\"category\\":\\"bug\\",\\"summary\\":\\"Test error\\"}\\n\`\`\`"}`;

      const result = parseNdjsonForResult(ndjson);
      expect(result).not.toBeNull();
      expect(result!.category).toBe('bug');
      expect(result!.summary).toBe('Test error');
    });

    it('searches from end to find last result', () => {
      const ndjson = `{"type":"result","result":"\`\`\`json\\n{\\"category\\":\\"first\\",\\"summary\\":\\"First\\"}\\n\`\`\`"}
{"type":"result","result":"\`\`\`json\\n{\\"category\\":\\"last\\",\\"summary\\":\\"Last\\"}\\n\`\`\`"}`;

      const result = parseNdjsonForResult(ndjson);
      expect(result!.category).toBe('last');
    });

    it('returns null when no result event found', () => {
      const ndjson = `{"type":"system","data":"init"}
{"type":"assistant","content":"no result here"}`;

      const result = parseNdjsonForResult(ndjson);
      expect(result).toBeNull();
    });

    it('handles result with newlines in JSON content', () => {
      const analysis = {
        category: 'bug',
        summary: 'Error message',
        code_example: 'line1\nline2',
      };
      const jsonStr = JSON.stringify(analysis);
      const markdownBlock = '```json\n' + jsonStr + '\n```';
      const resultEvent = JSON.stringify({ type: 'result', result: markdownBlock });
      const ndjson = `{"type":"system"}\n${resultEvent}`;

      const result = parseNdjsonForResult(ndjson);
      expect(result!.category).toBe('bug');
    });

    it('skips invalid JSON lines', () => {
      const ndjson = `not json
{"type":"system"}
also not json
{"type":"result","result":"\`\`\`json\\n{\\"category\\":\\"bug\\",\\"summary\\":\\"Found\\"}\\n\`\`\`"}`;

      const result = parseNdjsonForResult(ndjson);
      expect(result!.category).toBe('bug');
    });
  });

  describe('integration: simulates job 665 failure scenario', () => {
    it('recovers when result event is split across chunks', () => {
      // Simulate the exact scenario that caused job 665 to fail:
      // A long result event line split across multiple stdout chunks

      const analysis = {
        category: 'bug',
        priority: 'medium',
        summary: 'URL helper manage_edi_box_url inexistente',
        exception: { type: 'NoMethodError', message: 'undefined method' },
        root_cause: { hypothesis: 'Missing route helper', confidence: 'high' },
        fix: { suggestion: 'Use url_for instead' },
      };

      const jsonBlock = '```json\n' + JSON.stringify(analysis, null, 2) + '\n```';
      const resultEvent = JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: jsonBlock,
        duration_ms: 48839,
      });

      // Split the result event at arbitrary points (simulating chunk boundaries)
      const fullOutput = `{"type":"system","data":"init"}\n{"type":"assistant","content":"analyzing"}\n${resultEvent}\n`;

      // Simulate chunks splitting the result line
      const splitPoint1 = fullOutput.indexOf(resultEvent) + 100;
      const splitPoint2 = splitPoint1 + 200;

      const chunks = [
        fullOutput.substring(0, splitPoint1),
        fullOutput.substring(splitPoint1, splitPoint2),
        fullOutput.substring(splitPoint2),
      ];

      // Line buffering should reassemble the line
      const { lastResult } = processChunksWithLineBuffering(chunks);

      expect(lastResult).not.toBeNull();
      expect((lastResult as { type: string }).type).toBe('result');
      expect((lastResult as { result: string }).result).toContain('category');

      // Even if line buffering failed, NDJSON fallback should work
      const fallbackResult = parseNdjsonForResult(fullOutput);
      expect(fallbackResult).not.toBeNull();
      expect(fallbackResult!.category).toBe('bug');
      expect(fallbackResult!.summary).toBe('URL helper manage_edi_box_url inexistente');
    });
  });
});
