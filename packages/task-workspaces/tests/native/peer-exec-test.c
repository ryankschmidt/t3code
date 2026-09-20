#define _GNU_SOURCE
#include <sys/socket.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <sys/stat.h>
#include <unistd.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static int failures = 0;
static void check(const char *name, int condition) {
    printf("%s %s\n", condition ? "PASS" : "FAIL", name);
    if (!condition) failures++;
}
static void die(const char *name) { perror(name); exit(2); }

static void run(const char *name, const char *helper, const char *target, int input,
                const char *expected, int missing_args, int expected_status) {
    int output[2];
    if (pipe(output)) die("pipe");
    pid_t child = fork();
    if (child < 0) die("fork");
    if (child == 0) {
        if (dup2(input, STDIN_FILENO) < 0 || dup2(output[1], STDOUT_FILENO) < 0) _exit(120);
        close(output[0]); close(output[1]);
        setenv("THROUGHL_PEER_UID", "999999", 1);
        setenv("THROUGHL_PEER_GID", "999999", 1);
        setenv("THROUGHL_PEER_PID", "999999", 1);
        if (missing_args) execl(helper, helper, (char *)NULL);
        else execl(helper, helper, target, "--target", "argv-preserved", (char *)NULL);
        _exit(121);
    }
    close(output[1]);
    char result[256]; size_t used = 0;
    while (used < sizeof(result) - 1) {
        ssize_t n = read(output[0], result + used, sizeof(result) - 1 - used);
        if (n <= 0) break;
        used += (size_t)n;
    }
    result[used] = '\0'; close(output[0]);
    int status;
    if (waitpid(child, &status, 0) != child) die("waitpid");
    check(name, WIFEXITED(status) && WEXITSTATUS(status) == expected_status && strcmp(result, expected) == 0);
}

int main(int argc, char **argv) {
    if (argc >= 2 && strcmp(argv[1], "--target") == 0) {
        if (argc != 3 || strcmp(argv[2], "argv-preserved")) return 2;
        printf("TARGET:%s:%s:%s\n", getenv("THROUGHL_PEER_UID"), getenv("THROUGHL_PEER_GID"), getenv("THROUGHL_PEER_PID"));
        return 0;
    }
    if (argc != 2) return 2;
    char self[4096];
    ssize_t self_len = readlink("/proc/self/exe", self, sizeof(self) - 1);
    if (self_len < 0) die("self");
    self[self_len] = '\0';
    char directory[] = "/tmp/peer-exec-test-XXXXXX";
    if (!mkdtemp(directory)) die("mkdtemp");
    struct sockaddr_un address = { .sun_family = AF_UNIX };
    if (snprintf(address.sun_path, sizeof(address.sun_path), "%s/socket", directory) >= (int)sizeof(address.sun_path)) return 2;
    int listener = socket(AF_UNIX, SOCK_STREAM, 0);
    if (listener < 0 || bind(listener, (struct sockaddr *)&address, sizeof(address)) || listen(listener, 1)) die("listen");
    pid_t client = fork();
    if (client < 0) die("client fork");
    if (client == 0) {
        close(listener);
        int connection = socket(AF_UNIX, SOCK_STREAM, 0);
        if (connection < 0 || connect(connection, (struct sockaddr *)&address, sizeof(address))) _exit(2);
        for (;;) pause();
    }
    int connected = accept(listener, NULL, NULL);
    if (connected < 0) die("accept");
    char expected[256];
    snprintf(expected, sizeof(expected), "TARGET:%lu:%lu:%ld\n", (unsigned long)getuid(), (unsigned long)getgid(), (long)client);
    run("real accepted Unix peer plus poisoned environment and preserved argv", argv[1], self, connected, expected, 0, 0);
    run("missing target fails before exec", argv[1], self, connected, "", 1, 126);
    run("nonabsolute target fails before exec", argv[1], "relative-target", connected, "", 0, 126);
    run("missing executable reports exec failure", argv[1], "/no-such-peer-exec-target", connected, "", 0, 127);
    run("listening socket fails before exec", argv[1], self, listener, "", 0, 126);
    int unconnected = socket(AF_UNIX, SOCK_STREAM, 0);
    int tcp = socket(AF_INET, SOCK_STREAM, 0);
    int datagram[2], pipes[2];
    if (unconnected < 0 || tcp < 0 || socketpair(AF_UNIX, SOCK_DGRAM, 0, datagram) || pipe(pipes)) die("negative descriptors");
    char file_path[256]; snprintf(file_path, sizeof(file_path), "%s/file", directory);
    int file = open(file_path, O_CREAT | O_RDWR | O_EXCL, 0600);
    if (file < 0) die("file");
    run("unconnected Unix socket fails before exec", argv[1], self, unconnected, "", 0, 126);
    run("TCP socket fails before exec", argv[1], self, tcp, "", 0, 126);
    run("Unix datagram fails before exec", argv[1], self, datagram[0], "", 0, 126);
    run("pipe fails before exec", argv[1], self, pipes[0], "", 0, 126);
    run("regular file fails before exec", argv[1], self, file, "", 0, 126);
    close(connected); close(listener); close(unconnected); close(tcp);
    close(datagram[0]); close(datagram[1]); close(pipes[0]); close(pipes[1]); close(file);
    kill(client, SIGTERM); waitpid(client, NULL, 0);
    unlink(address.sun_path); unlink(file_path); rmdir(directory);
    printf("RESULT tests=10 failures=%d caller_uid=%lu caller_gid=%lu\n", failures, (unsigned long)getuid(), (unsigned long)getgid());
    return failures ? 1 : 0;
}
