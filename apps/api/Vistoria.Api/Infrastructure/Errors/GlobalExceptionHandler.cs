using System.Globalization;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Net.Http.Headers;

namespace Vistoria.Api.Infrastructure.Errors;

/// <summary>
/// Exceção → <c>ProblemDetails</c> com <c>type</c> do catálogo. Exceção fora do catálogo vira 500
/// <c>internal</c> sem mensagem nem stack trace; o detalhe fica só no log.
/// </summary>
public sealed class GlobalExceptionHandler(
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
            logger.LogError(exception, "Exceção não tratada em {Method} {Path}",
                httpContext.Request.Method, httpContext.Request.Path);
        }
        else
        {
            logger.LogInformation("Erro {Type} ({Status}) em {Method} {Path}: {Detail}",
                problem.Type, problem.Status, httpContext.Request.Method, httpContext.Request.Path, problem.Detail);
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
}
