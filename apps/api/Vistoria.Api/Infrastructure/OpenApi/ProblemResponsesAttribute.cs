namespace Vistoria.Api.Infrastructure.OpenApi;

/// <summary>
/// Status de erro que a action pode responder, como na coluna "Erros possíveis" da tabela de Endpoints
/// (backend.md). O <c>ContractOperationTransformer</c> documenta cada um como <c>application/problem+json</c>.
/// Na classe vale para todas as actions; classe e método se somam.
/// </summary>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = true)]
public sealed class ProblemResponsesAttribute : Attribute
{
    public ProblemResponsesAttribute(params int[] statusCodes)
    {
        foreach (var status in statusCodes)
        {
            if (status is < 400 or > 599)
            {
                throw new ArgumentOutOfRangeException(nameof(statusCodes), status, "Use status de erro (4xx ou 5xx).");
            }
        }

        StatusCodes = statusCodes;
    }

    public IReadOnlyList<int> StatusCodes { get; }
}
