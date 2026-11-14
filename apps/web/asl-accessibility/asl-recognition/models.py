"""Sequence classifier for isolated signs."""
import torch
import torch.nn as nn


class BiGRUAttention(nn.Module):
    """Bidirectional GRU over the frame sequence with additive attention
    pooling, so the most distinctive frame of a sign counts even when it is
    not the last one."""

    def __init__(self, feature_dim: int, n_classes: int, hidden: int = 128,
                 num_layers: int = 2, dropout: float = 0.3):
        super().__init__()
        self.gru = nn.GRU(
            feature_dim, hidden, num_layers=num_layers, batch_first=True,
            bidirectional=True, dropout=dropout if num_layers > 1 else 0.0,
        )
        gru_out_dim = hidden * 2
        self.attn = nn.Sequential(
            nn.Linear(gru_out_dim, gru_out_dim // 2),
            nn.Tanh(),
            nn.Linear(gru_out_dim // 2, 1),
        )
        self.classifier = nn.Sequential(
            nn.Dropout(dropout),
            nn.Linear(gru_out_dim, n_classes),
        )

    def forward(self, x):  # x: (B, T, D)
        out, _ = self.gru(x)  # (B, T, 2H)
        attn_weights = torch.softmax(self.attn(out), dim=1)  # (B, T, 1)
        pooled = (out * attn_weights).sum(dim=1)  # (B, 2H)
        return self.classifier(pooled)
