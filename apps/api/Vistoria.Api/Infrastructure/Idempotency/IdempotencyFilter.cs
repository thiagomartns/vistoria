using System.Runtime.ExceptionServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.Net.Http.Headers;
using Vistoria.Api.Configurations;
using Vistoria.Api.Infrastructure.Auth;
using Vistoria.Api.Infrastructure.Errors;
using Vistoria.Api.Infrastructure.OpenApi;
using Vistoria.Api.Model;
using Vistoria.Api.Repositories;

namespace Vistoria.Api.Infrastructure.Idempotency;

/// <summary>
/// <c>Idempotency-Key</c> em todo <c>PUT</c> e <c>DELETE</c> (backend.md, "Idempotência"). Roda antes do model binding,
/// então vem antes de qualquer outra regra da escrita: um retry nunca reexecuta nada. A chave entra no banco como
/// <c>processing</c> antes da action; quem perde o <c>INSERT</c> lê a linha e recebe a resposta gravada (mesmo pedido,
/// <c>done</c>), 409 <c>idempotency-in-progress</c> (mesmo pedido, <c>processing</c>) ou 422
/// <c>idempotency-key-reused</c> (outro pedido). Nenhum lock em memória: vale entre instâncias da API.
/// </summary>
public sealed class IdempotencyFilter(
    IIdempotencyRepository records,
    TimeProvider time,
    IEnumerable<IExceptionHandler> exceptionHandlers) : IAsyncResourceFilter
{
    private static readonly HashSet<string> WriteMethods =
        new(StringComparer.OrdinalIgnoreCase) { HttpMethods.Put, HttpMethods.Delete };

    /// <summary>Cabeçalhos que o reenvio repete; o resto (data, trace) é da nova resposta.</summary>
    private static readonly string[] ReplayedHeaders = [HeaderNames.ContentType, HeaderNames.ETag, HeaderNames.Location];

    public async Task OnResourceExecutionAsync(ResourceExecutingContext context, ResourceExecutionDelegate next)
    {
        var http = context.HttpContext;
        if (!WriteMethods.Contains(http.Request.Method))
        {
            await next();
            return;
        }

        var key = ParseKey(http.Request.Headers[ContractHeaders.IdempotencyKey]);
        var userId = http.User.GetUserId();
        var hash = await HashAsync(http.Request, http.RequestAborted);

        var existing = await StartAsync(userId, key, hash, http.RequestAborted);
        if (existing is null)
        {
            await ExecuteAndRecordAsync(http, userId, key, next);
            return;
        }

        if (!existing.RequestHash.AsSpan().SequenceEqual(hash))
        {
            throw new IdempotencyKeyReusedException();
        }

        if (existing.State == IdempotencyState.Processing)
        {
            throw new IdempotencyInProgressException(IdempotencyConfig.InProgressRetryAfter);
        }

        context.Result = new RecordedResponseResult(existing);
    }

    /// <summary>Só UUID v7, como o cliente gera. Ausente, repetida ou outro formato não identificam o pedido: 428.</summary>
    private static Guid ParseKey(Microsoft.Extensions.Primitives.StringValues values) =>
        values.Count == 1 && Guid.TryParse(values[0], out var key) && key.Version == 7
            ? key
            : throw new PreconditionRequiredException(ContractHeaders.IdempotencyKey);

    // SHA-256 de método, rota e corpo cru. O corpo fica em buffer e volta ao início para o model binding.
    private static async Task<byte[]> HashAsync(HttpRequest request, CancellationToken cancellationToken)
    {
        request.EnableBuffering();
        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        hash.AppendData(Encoding.UTF8.GetBytes($"{request.Method} {request.Path}{request.QueryString}\n"));

        var buffer = new byte[8192];
        int read;
        while ((read = await request.Body.ReadAsync(buffer, cancellationToken)) > 0)
        {
            hash.AppendData(buffer, 0, read);
        }

        request.Body.Position = 0;
        return hash.GetHashAndReset();
    }

    /// <summary>
    /// <c>null</c> quando esta requisição ganhou a chave. Uma linha vencida que o <c>CleanupService</c> ainda não
    /// apagou conta como inexistente: sai, e o <c>INSERT</c> é tentado de novo. Uma linha que some entre o
    /// <c>INSERT</c> recusado e a leitura (a outra terminou em 5xx) também.
    /// </summary>
    private async Task<IdempotencyRecord?> StartAsync(
        Guid userId, Guid key, byte[] hash, CancellationToken cancellationToken)
    {
        var now = time.GetUtcNow();
        var cutoff = now - IdempotencyConfig.KeyValidity;
        for (var attempt = 0; attempt < 3; attempt++)
        {
            var record = new IdempotencyRecord
            {
                UserId = userId,
                Key = key,
                RequestHash = hash,
                State = IdempotencyState.Processing,
                CreatedAt = now,
            };
            if (await records.TryStartAsync(record, cancellationToken))
            {
                return null;
            }

            var existing = await records.FindAsync(userId, key, cancellationToken);
            if (existing is null)
            {
                continue;
            }

            if (existing.CreatedAt >= cutoff)
            {
                return existing;
            }

            await records.DeleteIfExpiredAsync(userId, key, cutoff, cancellationToken);
        }

        // A chave trocou de dono três vezes seguidas: outra requisição com ela está ativa.
        throw new IdempotencyInProgressException(IdempotencyConfig.InProgressRetryAfter);
    }

    /// <summary>
    /// Executa a action com a resposta em buffer, para gravá-la antes de enviá-la: um reenvio que chegue logo depois
    /// já encontra a chave <c>done</c>. Exceção da action é escrita aqui pelo <c>GlobalExceptionHandler</c>, o mesmo
    /// <c>ProblemDetails</c> que o middleware escreveria, para o erro final também ser gravado. Respostas finais (2xx e
    /// 4xx, exceto 401 e 429) ficam; 5xx apaga a chave, para o retry executar de novo.
    /// </summary>
    private async Task ExecuteAndRecordAsync(
        HttpContext http, Guid userId, Guid key, ResourceExecutionDelegate next)
    {
        var original = http.Response.Body;
        await using var buffer = new MemoryStream();
        http.Response.Body = buffer;
        try
        {
            var exception = await RunAsync(next);
            if (exception is not null && !await WriteProblemAsync(http, exception))
            {
                await records.DeleteAsync(userId, key, CancellationToken.None);
                exception.Throw();
            }

            // A resposta já existe: gravar não depende mais de o cliente esperar por ela.
            var status = http.Response.StatusCode;
            if (IsFinal(status))
            {
                await records.CompleteAsync(
                    userId, key, status, RecordedHeaders(http.Response), buffer.ToArray(), CancellationToken.None);
            }
            else
            {
                await records.DeleteAsync(userId, key, CancellationToken.None);
            }
        }
        finally
        {
            http.Response.Body = original;
        }

        buffer.Position = 0;
        await buffer.CopyToAsync(original, http.RequestAborted);
    }

    private static async Task<ExceptionDispatchInfo?> RunAsync(ResourceExecutionDelegate next)
    {
        try
        {
            var executed = await next();
            if (executed.ExceptionDispatchInfo is { } exception && !executed.ExceptionHandled)
            {
                executed.ExceptionHandled = true;
                return exception;
            }

            return null;
        }
        catch (Exception exception)
        {
            return ExceptionDispatchInfo.Capture(exception);
        }
    }

    // Como o UseExceptionHandler: resposta limpa, depois o primeiro handler que aceitar.
    private async Task<bool> WriteProblemAsync(HttpContext http, ExceptionDispatchInfo exception)
    {
        http.Response.Clear();
        foreach (var handler in exceptionHandlers)
        {
            if (await handler.TryHandleAsync(http, exception.SourceException, http.RequestAborted))
            {
                return true;
            }
        }

        return false;
    }

    private static bool IsFinal(int status) =>
        status is >= 200 and < 500
        and not StatusCodes.Status401Unauthorized
        and not StatusCodes.Status429TooManyRequests;

    private static string RecordedHeaders(HttpResponse response) =>
        JsonSerializer.Serialize(ReplayedHeaders
            .Where(name => response.Headers.ContainsKey(name))
            .ToDictionary(name => name, name => response.Headers[name].ToString()));

    /// <summary>A resposta gravada, de novo: status, cabeçalhos de <see cref="ReplayedHeaders"/> e corpo.</summary>
    private sealed class RecordedResponseResult(IdempotencyRecord record) : IActionResult
    {
        public async Task ExecuteResultAsync(ActionContext context)
        {
            var response = context.HttpContext.Response;
            response.StatusCode = record.StatusCode ?? StatusCodes.Status500InternalServerError;
            var headers = JsonSerializer.Deserialize<Dictionary<string, string>>(record.ResponseHeaders ?? "{}") ?? [];
            foreach (var (name, value) in headers)
            {
                response.Headers[name] = value;
            }

            if (record.ResponseBody is { Length: > 0 } body)
            {
                await response.Body.WriteAsync(body, context.HttpContext.RequestAborted);
            }
        }
    }
}
