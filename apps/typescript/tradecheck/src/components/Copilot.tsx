'use client';

import { useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { ChatBubble } from './ui/ChatBubble';
import { Input } from './ui/Input';
import { Button } from './ui/Button';

export function Copilot() {
  const { messages, sendMessage, status } = useChat();
  const [input, setInput] = useState('');
  const isLoading = status === 'submitted' || status === 'streaming';

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    sendMessage({ text: input });
    setInput('');
  };

  return (
    <div className="flex flex-col h-full bg-app-bg">
      <div className="flex-1 overflow-y-auto p-6">
        {messages.length === 0 ? (
          <div className="text-center text-secondary-text mt-10">
            Tell me what trade partner you want to verify...
          </div>
        ) : (
          messages.map(m => (
            <ChatBubble
              key={m.id}
              role={m.role === 'user' ? 'user' : 'ai'}
              content={m.parts.map(p => (p.type === 'text' ? p.text : '')).join('')}
            />
          ))
        )}
        {isLoading && (
          <div className="text-secondary-text text-sm flex gap-2 items-center mt-4">
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" />
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
            <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
          </div>
        )}
      </div>

      <div className="p-4 bg-gray-200 border-t border-gray-300">
        <form onSubmit={handleSubmit} className="flex gap-2 bg-white p-2 rounded-lg border border-gray-300 items-center">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Describe the trade deal to verify..."
            className="border-none shadow-none focus:ring-0 flex-1 bg-transparent"
          />
          <Button type="submit" disabled={isLoading} className="w-10 h-10 p-0 rounded-full flex items-center justify-center flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2.01 21L23 12L2.01 3L2 10l15 2l-15 2z" fill="currentColor"/>
            </svg>
          </Button>
        </form>
        <div className="text-center mt-2 text-xs text-secondary-text">
          Enter To Send.
        </div>
      </div>
    </div>
  );
}