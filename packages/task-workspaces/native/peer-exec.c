#define _GNU_SOURCE
#include <sys/socket.h>
#include <sys/types.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>

static int refuse(const char *reason) {
    fprintf(stderr, "peer-exec: %s\n", reason);
    return 126;
}

/* The service unit owns argv and execution identity. This helper supplies facts, not grants. */
int main(int argc, char **argv) {
    struct sockaddr_storage local, peer;
    socklen_t local_len = sizeof(local), peer_len = sizeof(peer);
    int type = 0;
    socklen_t type_len = sizeof(type);
    struct ucred credentials;
    socklen_t credentials_len = sizeof(credentials);
    char uid[32], gid[32], pid[32];

    if (argc < 2 || argv[1][0] != '/') return refuse("absolute trusted executable required");
    if (getsockname(STDIN_FILENO, (struct sockaddr *)&local, &local_len) != 0 ||
        local.ss_family != AF_UNIX) return refuse("stdin must be an AF_UNIX socket");
    if (getsockopt(STDIN_FILENO, SOL_SOCKET, SO_TYPE, &type, &type_len) != 0 ||
        type_len != sizeof(type) || type != SOCK_STREAM) return refuse("stdin must be SOCK_STREAM");
    if (getpeername(STDIN_FILENO, (struct sockaddr *)&peer, &peer_len) != 0 ||
        peer.ss_family != AF_UNIX) return refuse("stdin must have a connected AF_UNIX peer");
    if (getsockopt(STDIN_FILENO, SOL_SOCKET, SO_PEERCRED, &credentials, &credentials_len) != 0 ||
        credentials_len != sizeof(credentials) || credentials.pid <= 0 ||
        credentials.uid == (uid_t)-1 || credentials.gid == (gid_t)-1) return refuse("peer credentials unavailable");
    if (snprintf(uid, sizeof(uid), "%lu", (unsigned long)credentials.uid) < 0 ||
        snprintf(gid, sizeof(gid), "%lu", (unsigned long)credentials.gid) < 0 ||
        snprintf(pid, sizeof(pid), "%ld", (long)credentials.pid) < 0) return refuse("credential formatting failed");
    if (setenv("THROUGHL_PEER_UID", uid, 1) != 0 ||
        setenv("THROUGHL_PEER_GID", gid, 1) != 0 ||
        setenv("THROUGHL_PEER_PID", pid, 1) != 0) return refuse("credential environment failed");
    execv(argv[1], argv + 1);
    perror("peer-exec: execv");
    return 127;
}
