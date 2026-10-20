using Vistoria.Api.Infrastructure.Errors;

namespace Vistoria.Api.Configurations;

public static class ErrorHandlingConfig
{
    public static IServiceCollection AddErrorHandling(this IServiceCollection services)
    {
        services.AddExceptionHandler<GlobalExceptionHandler>();
        services.AddProblemDetails(options => options.CustomizeProblemDetails = ApplyCatalogType);
        return services;
    }

    public static WebApplication UseErrorHandling(this WebApplication app)
    {
        app.UseExceptionHandler();
        app.UseStatusCodePages();
        return app;
    }

    // Respostas que não vieram de uma exceção do catálogo (status code pages, 400 automático e 415 do MVC)
    // ganham o type pelo status, com título e detalhe do catálogo.
    private static void ApplyCatalogType(ProblemDetailsContext context)
    {
        var problem = context.ProblemDetails;
        if (ProblemTypes.Contains(problem.Type))
        {
            return;
        }

        var status = problem.Status ?? context.HttpContext.Response.StatusCode;
        var type = ProblemTypes.FromStatus(status);
        problem.Type = type;
        problem.Status = status;
        problem.Title = ProblemTypes.TitleOf(type);
        problem.Detail = ProblemTypes.DetailOf(type);
    }
}
