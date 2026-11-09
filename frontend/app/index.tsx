import { Redirect } from 'expo-router';

/** App entry point — hands off to the auth gate, which resolves where to land. */
export default function Index() {
  return <Redirect href="/(auth-gate)" />;
}
