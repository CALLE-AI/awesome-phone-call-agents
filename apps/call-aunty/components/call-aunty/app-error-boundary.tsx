import { Component, type ErrorInfo, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

type Props = {
  children: ReactNode;
  title?: string;
  body?: string;
  retryLabel?: string;
};

type State = {
  error: Error | null;
};

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    if (typeof __DEV__ !== "undefined" && __DEV__) {
      console.error("[Call Aunty] render error", error, info.componentStack);
    }
  }

  private retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    const title = this.props.title ?? "Something went wrong";
    const body =
      this.props.body ?? "Your local records are still protected. Try again, or continue when the connection is stable.";
    const retryLabel = this.props.retryLabel ?? "Try again";

    return (
      <View style={styles.wrap} accessibilityRole="alert">
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          onPress={this.retry}
          style={({ pressed }) => [styles.button, pressed && styles.pressed]}
        >
          <Text style={styles.buttonLabel}>{retryLabel}</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 28,
    gap: 12,
    backgroundColor: "#F7F4F1",
  },
  title: { fontSize: 24, fontWeight: "800", color: "#1F1B16", letterSpacing: -0.4 },
  body: { fontSize: 15, lineHeight: 22, color: "#6B645D" },
  button: {
    marginTop: 8,
    backgroundColor: "#C45C4A",
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonLabel: { color: "#FFFFFF", fontWeight: "800", fontSize: 16 },
  pressed: { opacity: 0.86 },
});
