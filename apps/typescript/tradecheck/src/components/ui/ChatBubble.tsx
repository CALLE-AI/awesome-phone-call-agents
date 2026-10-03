import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface ChatBubbleProps {
  role: 'ai' | 'user';
  content: string | React.ReactNode;
}

/** Renders markdown content inside an AI chat bubble. */
function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Headings
        h1: ({ children }) => <h1 className="text-base font-bold text-primary-text mt-3 mb-1">{children}</h1>,
        h2: ({ children }) => <h2 className="text-sm font-bold text-primary-text mt-3 mb-1">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold text-primary-text mt-2 mb-1">{children}</h3>,
        // Paragraphs
        p: ({ children }) => <p className="text-sm text-primary-text mb-2 leading-relaxed">{children}</p>,
        // Lists
        ul: ({ children }) => <ul className="list-disc list-outside pl-4 mb-2 space-y-1 text-sm text-primary-text">{children}</ul>,
        ol: ({ children }) => <ol className="list-decimal list-outside pl-4 mb-2 space-y-1 text-sm text-primary-text">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        // Bold / italic
        strong: ({ children }) => <strong className="font-semibold text-primary-text">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        // Horizontal rule (--- dividers)
        hr: () => <hr className="my-3 border-gray-200" />,
        // Inline code
        code: ({ children }) => (
          <code className="px-1 py-0.5 bg-gray-100 rounded text-xs font-mono text-gray-700">{children}</code>
        ),
        // Code blocks
        pre: ({ children }) => (
          <pre className="bg-gray-50 border border-gray-200 rounded-lg p-3 my-2 overflow-x-auto text-xs font-mono leading-relaxed">{children}</pre>
        ),
        // Blockquote
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-gray-300 pl-3 my-2 text-secondary-text italic text-sm">{children}</blockquote>
        ),
        // Tables (from remark-gfm)
        table: ({ children }) => (
          <div className="overflow-x-auto my-2">
            <table className="text-xs w-full border-collapse">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-gray-50">{children}</thead>,
        th: ({ children }) => <th className="border border-gray-200 px-2 py-1.5 text-left font-semibold">{children}</th>,
        td: ({ children }) => <td className="border border-gray-200 px-2 py-1.5">{children}</td>,
        // Links
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline underline-offset-2 hover:text-blue-800">
            {children}
          </a>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

export function ChatBubble({ role, content }: ChatBubbleProps) {
  const isString = typeof content === 'string';

  if (role === 'ai') {
    return (
      <div className="flex items-start gap-4 mb-4">
        <div className="w-8 h-8 flex-shrink-0 bg-success-color text-white rounded-md flex items-center justify-center font-bold text-xs uppercase">
          AI
        </div>
        <div className="bg-white border border-gray-200 rounded-xl rounded-tl-none px-4 py-3 text-sm text-primary-text max-w-[85%]">
          {isString ? <MarkdownContent content={content} /> : content}
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start justify-end mb-4">
      <div className="bg-user-msg-bg px-4 py-3 rounded-xl rounded-tr-none text-sm text-primary-text max-w-[85%] whitespace-pre-wrap">
        {content}
      </div>
    </div>
  );
}
