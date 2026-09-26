import React, { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';

/**
 * Custom sanitize schema extending defaults to allow table attributes and safe links
 */
const sanitizeSchema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    a: ['href', 'target', 'rel', 'className'],
    code: ['className'],
    th: ['align'],
    td: ['align'],
  },
};

/**
 * Reusable Markdown Message renderer for OmniGraph Knowledge Workspace.
 * Adheres to Claude/ChatGPT prose conventions:
 * - Comfortable ~65-75ch reading width
 * - Semi-bold strong elements (font-weight: 600)
 * - Muted list markers and proper indent
 * - Accented links with hover-only underline
 * - Zero margin-collapse on first/last elements
 * - Soft typing / streaming indicator
 */
const MarkdownMessage = memo(function MarkdownMessage({
  content = '',
  isStreaming = false,
  className = '',
}) {
  const safeContent = typeof content === 'string' ? content : String(content || '');

  return (
    <div className={`markdown-content ${isStreaming ? 'is-streaming' : ''} ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, sanitizeSchema]]}
        components={{
          p: ({ children }) => <p className="markdown-p">{children}</p>,
          strong: ({ children }) => <strong className="markdown-strong">{children}</strong>,
          em: ({ children }) => <em className="markdown-em">{children}</em>,
          ul: ({ children }) => <ul className="markdown-ul">{children}</ul>,
          ol: ({ children }) => <ol className="markdown-ol">{children}</ol>,
          li: ({ children }) => <li className="markdown-li">{children}</li>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="markdown-link"
            >
              {children}
            </a>
          ),
          blockquote: ({ children }) => (
            <blockquote className="markdown-blockquote">{children}</blockquote>
          ),
          h1: ({ children }) => <h1 className="markdown-h1">{children}</h1>,
          h2: ({ children }) => <h2 className="markdown-h2">{children}</h2>,
          h3: ({ children }) => <h3 className="markdown-h3">{children}</h3>,
          h4: ({ children }) => <h4 className="markdown-h4">{children}</h4>,
          table: ({ children }) => (
            <div className="markdown-table-wrapper">
              <table className="markdown-table">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="markdown-th">{children}</th>,
          td: ({ children }) => <td className="markdown-td">{children}</td>,
          pre: ({ children }) => <pre className="markdown-pre">{children}</pre>,
          code: ({ inline, className: codeClass, children, ...props }) => {
            const isInline = inline ?? !String(children).includes('\n');
            if (isInline) {
              return (
                <code className="markdown-inline-code" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <code className="markdown-code-block" {...props}>
                {children}
              </code>
            );
          },
          hr: () => <hr className="markdown-hr" />,
        }}
      >
        {safeContent}
      </ReactMarkdown>

      {isStreaming && (
        <span
          className="streaming-cursor"
          aria-hidden="true"
          title="Generating response..."
        />
      )}
    </div>
  );
});

export default MarkdownMessage;
