using System.Globalization;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;

namespace Vistoria.Api.Infrastructure.Errors;

/// <summary>
/// Exceção → <c>ProblemDetails</c> com <c>type</c> do catálogo. Exceção fora do catálogo vira 500
/// <c>internal</c> sem mensagem nem stack trace; o detalhe fica só no log.
/// </summary>
public sealed partial class GlobalExceptionHandler(
    IProblemDetailsService problemDetailsService,
    ILogger<GlobalExceptionHandler> logger) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(
        HttpContext httpContext,
        Exception exception,
        CancellationToken cancellationToken)
    {
        var problem = exception as AppException;
        if (problem is null)
        {
            LogUnhandled(logger, exception, httpContext.Request.Method, httpContext.Request.Path);
        }
        else
        {
            LogAppError(logger, problem.Type, problem.Status, httpContext.Request.Method, httpContext.Request.Path,
                problem.Detail);
        }

        problem ??= new InternalException();

        var problemDetails = new ProblemDetails
        {
            Type = problem.Type,
            Title = problem.Title,
            Status = problem.Status,
            Detail = problem.Detail,
        };
        foreach (var (key, value) in problem.Extensions)
        {
            problemDetails.Extensions[key] = value;
        }

        httpContext.Response.StatusCode = problem.Status;
        if (problem.RetryAfter is { } retryAfter)
        {
            httpContext.Response.Headers[HeaderNames.RetryAfter] =
                ((int)Math.Ceiling(retryAfter.TotalSeconds)).ToString(CultureInfo.InvariantCulture);
        }

        // A exceção não vai no contexto: assim nenhum writer a serializa no corpo.
        return await problemDetailsService.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = httpContext,
            ProblemDetails = problemDetails,
        });
    }

    [LoggerMessage(Level = LogLevel.Error, Message = "Exceção não tratada em {Method} {Path}")]
    private static partial void LogUnhandled(ILogger logger, Exception exception, string method, PathString path);

    [LoggerMessage(Level = LogLevel.Information, Message = "Erro {Type} ({Status}) em {Method} {Path}: {Detail}")]
    private static partial void LogAppError(
        ILogger logger, string type, int status, string method, PathString path, string detail);
}
