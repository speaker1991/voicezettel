import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, signIn, signOut, auth } = NextAuth({
    providers: [Google],
    pages: {
        signIn: "/login",
    },
    callbacks: {
        authorized({ auth: session, request }) {
            const isLoggedIn = !!session?.user;
            const isLoginPage =
                request.nextUrl.pathname.startsWith("/login");
            const isApiAuth =
                request.nextUrl.pathname.startsWith("/api/auth");

            // Allow API auth routes always
            if (isApiAuth) return true;

            // If on login page and logged in → redirect to home
            if (isLoginPage && isLoggedIn) {
                return Response.redirect(
                    new URL("/", request.nextUrl),
                );
            }

            // If on login page and not logged in → allow
            if (isLoginPage) return true;

            // All other pages → require auth
            return isLoggedIn;
        },
    },
});
