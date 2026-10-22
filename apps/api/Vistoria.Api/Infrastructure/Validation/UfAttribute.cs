using System.ComponentModel.DataAnnotations;

namespace Vistoria.Api.Infrastructure.Validation;

/// <summary>
/// Sigla de uma das 27 unidades da federação, em maiúsculas. <c>null</c> e <c>""</c> passam: quem cobra a presença
/// é o <c>[Required]</c>, para o campo vazio não sair com duas mensagens.
/// </summary>
[AttributeUsage(AttributeTargets.Property | AttributeTargets.Field | AttributeTargets.Parameter)]
public sealed class UfAttribute : ValidationAttribute
{
    public static readonly IReadOnlySet<string> All = new HashSet<string>(StringComparer.Ordinal)
    {
        "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
        "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
    };

    public UfAttribute()
        : base("Informe a sigla de uma UF, em maiúsculas.")
    {
    }

    public override bool IsValid(object? value) => value switch
    {
        null or "" => true,
        string s => All.Contains(s),
        _ => false,
    };
}
